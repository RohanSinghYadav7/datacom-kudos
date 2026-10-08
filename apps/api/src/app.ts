import { createHash, randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { Prisma, PrismaClient } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma as defaultPrisma } from "./db.js";
import { HttpError } from "./errors.js";
import { hashPassword, verifyPassword } from "./security/password.js";
import { createCursor, createOpaqueToken, hashToken, readCursor, safeEqualText } from "./security/tokens.js";
import {
  countCodePoints,
  createKudosSchema,
  deleteModerationSchema,
  loginSchema,
  MAX_MODERATION_REASON_LENGTH,
  MESSAGE_MAX_CODE_POINTS,
  moderationSchema,
  normalizeEmail,
  normalizeMessage,
  registrationSchema,
} from "./security/validation.js";
import type { AuthenticatedUser } from "./types.js";

const SESSION_COOKIE = "kudos_session";
const SESSION_TTL_DAYS = Number.parseInt(process.env.SESSION_TTL_DAYS ?? "7", 10);
if (!Number.isInteger(SESSION_TTL_DAYS) || SESSION_TTL_DAYS < 1 || SESSION_TTL_DAYS > 30) {
  throw new Error("SESSION_TTL_DAYS must be an integer between 1 and 30.");
}
const HOURLY_SUBMISSION_LIMIT = 10;
const IDEMPOTENCY_TTL_HOURS = 24;
const CURSOR_DEFAULT_PAGE_SIZE = 20;
const CURSOR_MAX_PAGE_SIZE = 100;
const publicUserSelect = { id: true, name: true, email: true, role: true } satisfies Prisma.UserSelect;

type Database = PrismaClient;
type SerializedKudos = {
  id: string;
  sender: { id: string; name: string };
  recipient: { id: string; name: string };
  message: string;
  createdAt: string;
};

function toPublicUser(user: { id: string; name: string; email: string; role: string }): AuthenticatedUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function serializeKudos(item: {
  id: string;
  senderUserId: string;
  recipientUserId: string;
  message: string;
  createdAt: Date;
  sender: { id: string; name: string };
  recipient: { id: string; name: string };
}): SerializedKudos {
  return {
    id: item.id,
    sender: { id: item.senderUserId, name: item.sender.name },
    recipient: { id: item.recipientUserId, name: item.recipient.name },
    message: item.message,
    createdAt: item.createdAt.toISOString(),
  };
}

function zodError(error: ZodError): HttpError {
  const issue = error.issues[0];
  return new HttpError(422, "validation_error", issue?.message ?? "The request is invalid.", issue?.path.join("."));
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw zodError(result.error);
  return result.data;
}

function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.authUser || !req.csrfToken) {
    next(new HttpError(401, "unauthenticated", "Sign in to continue."));
    return;
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.authUser?.role !== "ADMIN") {
    console.warn(JSON.stringify({
      event: "admin_action_denied",
      requestId: req.requestId,
      route: req.path,
      actorId: req.authUser?.id ?? null,
    }));
    res.status(403).json({
      error: { code: "forbidden", message: "Administrator permission is required." },
      requestId: req.requestId,
    });
    return;
  }
  next();
}

function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  const token = req.get("x-csrf-token");
  if (!req.csrfToken || !token || !safeEqualText(req.csrfToken, token)) {
    next(new HttpError(403, "csrf_failed", "The security token is missing or invalid."));
    return;
  }
  next();
}

function requestHasTrustedOrigin(req: Request): boolean {
  const suppliedOrigin = req.get("origin");
  const suppliedReferer = req.get("referer");
  const source = suppliedOrigin ?? suppliedReferer;
  if (!source) return false;
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return false;
  }

  const configuredOrigin = process.env.PUBLIC_APP_ORIGIN;
  if (configuredOrigin) {
    try {
      return sourceUrl.origin === new URL(configuredOrigin).origin;
    } catch {
      return false;
    }
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(`${req.protocol}://${req.get("host")}`);
  } catch {
    return false;
  }
  if (sourceUrl.origin === requestUrl.origin) return true;
  return process.env.NODE_ENV !== "production"
    && ["localhost", "127.0.0.1", "::1"].includes(sourceUrl.hostname)
    && ["localhost", "127.0.0.1", "::1"].includes(requestUrl.hostname);
}

function sameOriginForUnsafeMethods(req: Request, _res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  if (!requestHasTrustedOrigin(req)) {
    next(new HttpError(403, "origin_check_failed", "The request origin is not allowed."));
    return;
  }
  next();
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

function boundedLimit(raw: unknown): number {
  if (raw === undefined) return CURSOR_DEFAULT_PAGE_SIZE;
  if (typeof raw !== "string" || !/^\d{1,3}$/.test(raw)) {
    throw new HttpError(400, "invalid_limit", "Page size must be an integer between 1 and 100.");
  }
  const value = Number(raw);
  if (value < 1 || value > CURSOR_MAX_PAGE_SIZE) {
    throw new HttpError(400, "invalid_limit", "Page size must be an integer between 1 and 100.");
  }
  return value;
}

function requiredRouteParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "invalid_request", "A required path parameter is invalid.");
  }
  return value;
}

function cursorWhere(cursorValue: unknown): Prisma.KudosWhereInput | undefined {
  if (cursorValue === undefined) return undefined;
  if (typeof cursorValue !== "string" || !cursorValue) {
    throw new HttpError(400, "invalid_cursor", "The feed cursor is invalid.");
  }
  const cursor = readCursor(cursorValue);
  if (!cursor) throw new HttpError(400, "invalid_cursor", "The feed cursor is invalid.");
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

function encodeNextCursor<T extends { id: string; createdAt: Date }>(items: T[], hasMore: boolean): string | null {
  const last = items.at(-1);
  return hasMore && last ? createCursor(last.createdAt, last.id) : null;
}

function formatValidationResponse(error: ZodError): HttpError {
  return zodError(error);
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;

function applyLoginRateLimit(req: Request): void {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const current = loginAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > LOGIN_MAX_ATTEMPTS) {
    throw new HttpError(429, "rate_limited", "Too many sign-in attempts. Try again later.");
  }
}

function createSessionCookie(res: Response, rawToken: string): void {
  res.cookie(SESSION_COOKIE, rawToken, sessionCookieOptions());
}

function isPrismaUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function createApp(database: Database = defaultPrisma): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    const startedAt = Date.now();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.on("finish", () => {
      console.info(JSON.stringify({
        event: "http_request",
        requestId: req.requestId,
        method: req.method,
        route: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      }));
    });
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token || token.length > 256) {
      next();
      return;
    }
    void database.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { ...publicUserSelect, active: true } } },
    }).then(async (session) => {
      if (!session) return;
      if (session.expiresAt <= new Date() || !session.user) {
        res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
        return;
      }
      if (!session.user.active) {
        res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
        return;
      }
      req.authUser = toPublicUser(session.user);
      req.csrfToken = session.csrfToken;
    }).then(() => next()).catch(next);
  });

  app.use("/api", sameOriginForUnsafeMethods);

  const auth = express.Router();
  auth.get("/me", requireAuth, (req, res) => {
    res.json({ user: req.authUser, csrfToken: req.csrfToken });
  });

  auth.post("/register", async (req, res) => {
    const values = parseBody(registrationSchema, req.body);
    const email = normalizeEmail(values.email);
    const passwordHash = await hashPassword(values.password);
    let user;
    try {
      user = await database.user.create({
        data: { name: values.name, email, passwordHash },
        select: publicUserSelect,
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        throw new HttpError(409, "email_exists", "An account with this email already exists.", "email");
      }
      throw error;
    }

    const rawToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await database.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await database.session.create({
      data: { tokenHash: hashToken(rawToken), csrfToken, userId: user.id, expiresAt },
    });
    createSessionCookie(res, rawToken);
    res.status(201).json({ user: toPublicUser(user), csrfToken });
  });

  auth.post("/login", async (req, res) => {
    applyLoginRateLimit(req);
    const values = parseBody(loginSchema, req.body);
    const user = await database.user.findUnique({
      where: { email: normalizeEmail(values.email) },
      select: { ...publicUserSelect, passwordHash: true, active: true },
    });
    const valid = user ? await verifyPassword(values.password, user.passwordHash) : false;
    if (!user || !user.active || !valid) {
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    }

    const rawToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await database.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await database.session.create({
      data: { tokenHash: hashToken(rawToken), csrfToken, userId: user.id, expiresAt },
    });
    createSessionCookie(res, rawToken);
    res.json({ user: toPublicUser(user), csrfToken });
  });

  auth.post("/logout", requireAuth, csrfProtection, async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string;
    await database.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    res.status(204).end();
  });

  app.use("/api/auth", auth);

  const users = express.Router();
  users.use(requireAuth);
  users.get("/search", async (req, res) => {
    const querySchema = z.object({
      q: z.string().trim().min(2).max(100),
      limit: z.string().regex(/^\d{1,2}$/).optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw formatValidationResponse(parsed.error);
    const limit = parsed.data.limit ? Number(parsed.data.limit) : 10;
    if (limit < 1 || limit > 20) {
      throw new HttpError(400, "invalid_limit", "Search result limit must be between 1 and 20.");
    }
    const results = await database.user.findMany({
      where: {
        active: true,
        id: { not: req.authUser!.id },
        name: { contains: parsed.data.q },
      },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit,
    });
    res.json({ items: results });
  });
  app.use("/api/v1/users", users);

  const kudos = express.Router();
  kudos.use(requireAuth);
  kudos.get("/", async (req, res) => {
    const limit = boundedLimit(req.query.limit);
    const where = cursorWhere(req.query.cursor);
    const rows = await database.kudos.findMany({
      where: { isVisible: true, ...where },
      include: {
        sender: { select: { id: true, name: true } },
        recipient: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    res.json({
      items: page.map(serializeKudos),
      nextCursor: encodeNextCursor(page, hasMore),
    });
  });

  kudos.post("/", csrfProtection, async (req, res) => {
    const values = parseBody(createKudosSchema, req.body);
    const message = normalizeMessage(values.message);
    if (!message) throw new HttpError(422, "message_required", "Enter a message.", "message");
    if (countCodePoints(message) > MESSAGE_MAX_CODE_POINTS) {
      throw new HttpError(
        422,
        "message_too_long",
        `Messages must be ${MESSAGE_MAX_CODE_POINTS} characters or fewer.`,
        "message",
      );
    }
    if (values.recipientUserId === req.authUser!.id) {
      throw new HttpError(422, "self_kudos_not_allowed", "Choose a colleague other than yourself.", "recipientUserId");
    }

    const requestHash = createHash("sha256")
      .update(`${values.recipientUserId}\0${message}`)
      .digest("hex");
    const headerKey = req.get("idempotency-key");
    if (headerKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(headerKey)) {
      throw new HttpError(400, "invalid_idempotency_key", "The idempotency key is invalid.");
    }

    if (headerKey) {
      const existing = await database.idempotencyKey.findFirst({
        where: { actorId: req.authUser!.id, key: headerKey, expiresAt: { gt: new Date() } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new HttpError(409, "idempotency_conflict", "This request key was already used with different data.");
        }
        const previous = await database.kudos.findUnique({
          where: { id: existing.kudosId },
          include: { sender: { select: { id: true, name: true } }, recipient: { select: { id: true, name: true } } },
        });
        if (!previous) throw new HttpError(410, "idempotency_resource_deleted", "The original kudos has been deleted.");
        res.status(200).json({ item: serializeKudos(previous), replayed: true });
        return;
      }
    }

    const recipient = await database.user.findFirst({
      where: { id: values.recipientUserId, active: true },
      select: { id: true },
    });
    if (!recipient) throw new HttpError(404, "recipient_unavailable", "The selected colleague is unavailable.");

    const now = new Date();
    const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
    try {
      const created = await database.$transaction(async (tx) => {
        await tx.submissionRateWindow.deleteMany({
          where: {
            actorId: req.authUser!.id,
            windowStart: { lt: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
          },
        });
        if (headerKey) {
          await tx.idempotencyKey.deleteMany({
            where: { actorId: req.authUser!.id, key: headerKey, expiresAt: { lte: now } },
          });
        }
        const rateWindow = await tx.submissionRateWindow.upsert({
          where: { actorId_windowStart: { actorId: req.authUser!.id, windowStart } },
          create: { actorId: req.authUser!.id, windowStart, count: 1 },
          update: { count: { increment: 1 } },
        });
        if (rateWindow.count > HOURLY_SUBMISSION_LIMIT) {
          return { limited: true as const };
        }

        const result = await tx.kudos.create({
          data: {
            senderUserId: req.authUser!.id,
            recipientUserId: recipient.id,
            message,
          },
          include: {
            sender: { select: { id: true, name: true } },
            recipient: { select: { id: true, name: true } },
          },
        });
        if (headerKey) {
          await tx.idempotencyKey.create({
            data: {
              actorId: req.authUser!.id,
              key: headerKey,
              requestHash,
              kudosId: result.id,
              expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000),
            },
          });
        }
        return { limited: false as const, result };
      });
      if (created.limited) {
        res.setHeader("Retry-After", String(Math.max(1, 60 - now.getUTCMinutes())));
        throw new HttpError(429, "rate_limited", "You have reached the hourly kudos limit. Try again later.");
      }
      res.status(201).json({ item: serializeKudos(created.result), replayed: false });
    } catch (error) {
      if (headerKey && isPrismaUniqueError(error)) {
        const raced = await database.idempotencyKey.findUnique({
          where: { actorId_key: { actorId: req.authUser!.id, key: headerKey } },
        });
        if (raced) {
          if (raced.requestHash !== requestHash) {
            throw new HttpError(409, "idempotency_conflict", "This request key was already used with different data.");
          }
          const previous = await database.kudos.findUnique({
            where: { id: raced.kudosId },
            include: { sender: { select: { id: true, name: true } }, recipient: { select: { id: true, name: true } } },
          });
          if (previous) {
            res.status(200).json({ item: serializeKudos(previous), replayed: true });
            return;
          }
        }
      }
      throw error;
    }
  });
  app.use("/api/v1/kudos", kudos);

  const admin = express.Router();
  admin.use(requireAuth, requireAdmin);

  admin.get("/kudos", async (req, res) => {
    const limit = boundedLimit(req.query.limit);
    const where = cursorWhere(req.query.cursor);
    const rows = await database.kudos.findMany({
      where,
      include: {
        sender: { select: { id: true, name: true } },
        recipient: { select: { id: true, name: true } },
        moderator: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    res.json({
      items: page.map((item) => ({
        ...serializeKudos(item),
        isVisible: item.isVisible,
        moderation: item.moderatedAt ? {
          moderator: item.moderator ? { id: item.moderator.id, name: item.moderator.name } : null,
          moderatedAt: item.moderatedAt.toISOString(),
          reason: item.reasonForModeration,
        } : null,
      })),
      nextCursor: encodeNextCursor(page, hasMore),
    });
  });

  admin.post("/kudos/:id/moderation", csrfProtection, async (req, res) => {
    const values = parseBody(moderationSchema, req.body);
    if (values.reason.length > MAX_MODERATION_REASON_LENGTH) {
      throw new HttpError(422, "reason_too_long", "The moderation reason is too long.", "reason");
    }
    const id = requiredRouteParam(req, "id");
    const existing = await database.kudos.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "kudos_not_found", "Kudos not found.");
    if (values.action === "hide" && !existing.isVisible) {
      throw new HttpError(409, "already_hidden", "This kudos is already hidden.");
    }
    if (values.action === "restore" && existing.isVisible) {
      throw new HttpError(409, "already_visible", "This kudos is already visible.");
    }
    const now = new Date();
    const updated = await database.$transaction(async (tx) => {
      await tx.moderationAudit.create({
        data: {
          kudosId: existing.id,
          moderatorId: req.authUser!.id,
          action: values.action.toUpperCase(),
          reason: values.reason,
        },
      });
      return tx.kudos.update({
        where: { id: existing.id },
        data: values.action === "hide"
          ? {
            isVisible: false,
            moderatedBy: req.authUser!.id,
            moderatedAt: now,
            reasonForModeration: values.reason,
          }
          : {
            isVisible: true,
            moderatedBy: null,
            moderatedAt: null,
            reasonForModeration: null,
          },
      });
    });
    res.json({ id: updated.id, isVisible: updated.isVisible });
  });

  admin.delete("/kudos/:id", csrfProtection, async (req, res) => {
    const values = parseBody(deleteModerationSchema, req.body);
    if (values.reason.length > MAX_MODERATION_REASON_LENGTH) {
      throw new HttpError(422, "reason_too_long", "The moderation reason is too long.", "reason");
    }
    const id = requiredRouteParam(req, "id");
    const existing = await database.kudos.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new HttpError(404, "kudos_not_found", "Kudos not found.");
    await database.$transaction(async (tx) => {
      await tx.moderationAudit.create({
        data: {
          kudosId: existing.id,
          moderatorId: req.authUser!.id,
          action: "DELETE",
          reason: values.reason,
        },
      });
      await tx.kudos.delete({ where: { id: existing.id } });
    });
    res.status(204).end();
  });

  app.use("/api/v1/admin", admin);

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api", (_req, _res, next) => {
    next(new HttpError(404, "not_found", "The requested endpoint was not found."));
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: { code: "malformed_json", message: "Request body must be valid JSON." }, requestId: req.requestId });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.field ? { field: error.field } : {}),
        },
        requestId: req.requestId,
      });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      res.status(409).json({
        error: { code: "related_record_conflict", message: "This record is referenced and cannot be removed." },
        requestId: req.requestId,
      });
      return;
    }
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 500;
    if (status === 413) {
      res.status(413).json({ error: { code: "payload_too_large", message: "Request body is too large." }, requestId: req.requestId });
      return;
    }
    console.error(JSON.stringify({
      event: "request_failed",
      requestId: req.requestId,
      route: req.path,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    res.status(500).json({
      error: { code: "internal_error", message: "An unexpected error occurred." },
      requestId: req.requestId,
    });
  };
  app.use(errorHandler);

  return app;
}
