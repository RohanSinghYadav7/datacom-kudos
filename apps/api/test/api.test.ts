import "../src/env.js";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/security/password.js";

const prisma = new PrismaClient();
const app = createApp(prisma);
const origin = "http://localhost:5173";
type Agent = ReturnType<typeof request.agent>;

async function createAccount(
  email: string,
  role: "USER" | "ADMIN" = "USER",
): Promise<{ agent: Agent; csrfToken: string; id: string }> {
  const passwordHash = await hashPassword("an-internal-test-password");
  const user = await prisma.user.create({
    data: {
      email,
      name: email.split("@")[0]!,
      passwordHash,
      role,
    },
  });
  const agent = request.agent(app);
  const response = await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email, password: "an-internal-test-password" });
  expect(response.status).toBe(200);
  return { agent, csrfToken: response.body.csrfToken as string, id: user.id };
}

async function createKudos(
  agent: Agent,
  csrfToken: string,
  recipientUserId: string,
  message = "Thank you for helping the team.",
  key = `test-key-${Math.random().toString(36).slice(2, 12)}`,
) {
  return agent
    .post("/api/v1/kudos")
    .set("Origin", origin)
    .set("X-CSRF-Token", csrfToken)
    .set("Idempotency-Key", key)
    .send({ recipientUserId, message });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.moderationAudit.deleteMany();
  await prisma.kudos.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.submissionRateWindow.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Kudos API", () => {
  it("persists the required mapped columns and database-level invariants", async () => {
    const columns = await prisma.$queryRaw<Array<{
      name: string;
      type: string;
      notnull: bigint;
      dflt_value: string | null;
    }>>`PRAGMA table_info("Kudos")`;
    const byName = new Map(columns.map((column) => [column.name, column]));
    expect(byName.get("is_visible")).toMatchObject({ type: "BOOLEAN", notnull: 1n, dflt_value: "true" });
    expect(byName.get("created_at")?.type).toBe("DATETIME");
    expect(byName.has("moderated_by")).toBe(true);
    expect(byName.has("moderated_at")).toBe(true);
    expect(byName.has("reason_for_moderation")).toBe(true);

    const sender = await createAccount("sender@example.test");
    const recipient = await createAccount("recipient@example.test");
    await expect(prisma.kudos.create({
      data: {
        senderUserId: sender.id,
        recipientUserId: recipient.id,
        message: "😀".repeat(501),
      },
    })).rejects.toThrow();
  });

  it("requires a session and enforces CSRF protection on writes", async () => {
    const anonymous = request(app);
    expect((await anonymous.get("/api/v1/kudos")).status).toBe(401);
    expect((await anonymous.get("/api/v1/users/search?q=jo")).status).toBe(401);

    const user = await createAccount("person@example.test");
    const missingCsrf = await user.agent
      .post("/api/v1/kudos")
      .set("Origin", origin)
      .send({ recipientUserId: "some-user-id", message: "Thanks." });
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.error.code).toBe("csrf_failed");
  });

  it("registers a normal account and rejects duplicate email addresses", async () => {
    const input = { name: "New Person", email: "new@example.test", password: "a-secure-test-password" };
    const registered = await request(app).post("/api/auth/register").set("Origin", origin).send(input);
    expect(registered.status).toBe(201);
    expect(registered.body.user.role).toBe("USER");
    expect(registered.headers["set-cookie"]).toBeDefined();

    const duplicate = await request(app).post("/api/auth/register").set("Origin", origin).send(input);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.field).toBe("email");
  });

  it("rejects malformed, empty, whitespace-only, overlong, and self-directed submissions", async () => {
    const sender = await createAccount("sender@example.test");
    const recipient = await createAccount("recipient@example.test");

    const malformed = await sender.agent
      .post("/api/v1/kudos")
      .set("Origin", origin)
      .set("X-CSRF-Token", sender.csrfToken)
      .send({ recipientUserId: recipient.id, message: "Thanks.", senderUserId: recipient.id });
    expect(malformed.status).toBe(422);

    for (const message of ["", " \t\r\n "]) {
      const empty = await createKudos(sender.agent, sender.csrfToken, recipient.id, message);
      expect(empty.status).toBe(422);
      expect(empty.body.error.field).toBe("message");
    }

    const overLimit = await createKudos(sender.agent, sender.csrfToken, recipient.id, "😀".repeat(501));
    expect(overLimit.status).toBe(422);
    expect(overLimit.body.error.code).toBe("message_too_long");

    const self = await createKudos(sender.agent, sender.csrfToken, sender.id);
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe("self_kudos_not_allowed");
    expect(await prisma.kudos.count()).toBe(0);

    const invalidRecipient = await createKudos(sender.agent, sender.csrfToken, "unavailable-user");
    expect(invalidRecipient.status).toBe(404);
    expect(await prisma.kudos.count()).toBe(0);
  });

  it("creates kudos with server-derived sender and supports idempotent retries", async () => {
    const sender = await createAccount("sender@example.test");
    const recipient = await createAccount("recipient@example.test");
    const key = "same-request-key-0001";

    const first = await createKudos(sender.agent, sender.csrfToken, recipient.id, "  Great work!  ", key);
    expect(first.status).toBe(201);
    expect(first.body.item.sender.id).toBe(sender.id);
    expect(first.body.item.recipient.id).toBe(recipient.id);
    expect(first.body.item.message).toBe("Great work!");
    expect(first.body.replayed).toBe(false);

    const retry = await createKudos(sender.agent, sender.csrfToken, recipient.id, "Great work!", key);
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.item.id).toBe(first.body.item.id);

    const changed = await createKudos(sender.agent, sender.csrfToken, recipient.id, "Different message", key);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("idempotency_conflict");
    expect(await prisma.kudos.count()).toBe(1);
  });

  it("allows distinct repeat recognition but rate limits spam bursts", async () => {
    const sender = await createAccount("sender@example.test");
    const recipient = await createAccount("recipient@example.test");

    const first = await createKudos(sender.agent, sender.csrfToken, recipient.id, "Thanks.", "repeat-key-0001");
    const repeat = await createKudos(sender.agent, sender.csrfToken, recipient.id, "Thanks.", "repeat-key-0002");
    expect(first.status).toBe(201);
    expect(repeat.status).toBe(201);

    for (let index = 2; index < 10; index += 1) {
      const response = await createKudos(
        sender.agent,
        sender.csrfToken,
        recipient.id,
        `Appreciation ${index}`,
        `spam-test-key-${index.toString().padStart(2, "0")}`,
      );
      expect(response.status).toBe(201);
    }
    const limited = await createKudos(sender.agent, sender.csrfToken, recipient.id, "One more", "spam-test-key-11");
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(await prisma.kudos.count()).toBe(10);
  });

  it("paginates newest visible kudos deterministically and omits hidden content", async () => {
    const sender = await createAccount("sender@example.test");
    const recipient = await createAccount("recipient@example.test");
    const admin = await createAccount("admin@example.test", "ADMIN");
    const created = await createKudos(sender.agent, sender.csrfToken, recipient.id);
    const kudosId = created.body.item.id as string;

    const hide = await admin.agent
      .post(`/api/v1/admin/kudos/${kudosId}/moderation`)
      .set("Origin", origin)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ action: "hide", reason: "Inappropriate language reported." });
    expect(hide.status).toBe(200);

    const feed = await sender.agent.get("/api/v1/kudos?limit=20");
    expect(feed.status).toBe(200);
    expect(feed.body.items).toEqual([]);

    const adminList = await admin.agent.get("/api/v1/admin/kudos?limit=20");
    expect(adminList.status).toBe(200);
    expect(adminList.body.items[0].isVisible).toBe(false);
    expect(adminList.body.items[0].moderation.reason).toBe("Inappropriate language reported.");
    expect(await prisma.moderationAudit.count({ where: { action: "HIDE" } })).toBe(1);
  });

  it("uses stable keyset pagination when timestamps are identical", async () => {
    const sender = await createAccount("sender@example.test");
    const recipient = await createAccount("recipient@example.test");
    const createdAt = new Date("2026-10-08T10:00:00.000Z");
    for (let index = 0; index < 21; index += 1) {
      await prisma.kudos.create({
        data: {
          senderUserId: sender.id,
          recipientUserId: recipient.id,
          message: `Recognition note ${index}.`,
          createdAt,
        },
      });
    }

    const first = await sender.agent.get("/api/v1/kudos?limit=20");
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await sender.agent.get(`/api/v1/kudos?limit=20&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const ids = [...first.body.items, ...second.body.items].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(21);
  });

  it("restricts moderation to admins and supports hide, restore, and audited permanent deletion", async () => {
    const sender = await createAccount("sender@example.test");
    const recipient = await createAccount("recipient@example.test");
    const admin = await createAccount("admin@example.test", "ADMIN");
    const item = await createKudos(sender.agent, sender.csrfToken, recipient.id);
    const id = item.body.item.id as string;

    const forbidden = await sender.agent
      .post(`/api/v1/admin/kudos/${id}/moderation`)
      .set("Origin", origin)
      .set("X-CSRF-Token", sender.csrfToken)
      .send({ action: "hide", reason: "Attempt." });
    expect(forbidden.status).toBe(403);

    const missingReason = await admin.agent
      .post(`/api/v1/admin/kudos/${id}/moderation`)
      .set("Origin", origin)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ action: "hide", reason: " " });
    expect(missingReason.status).toBe(422);

    const hidden = await admin.agent
      .post(`/api/v1/admin/kudos/${id}/moderation`)
      .set("Origin", origin)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ action: "hide", reason: "Reported as inappropriate." });
    expect(hidden.status).toBe(200);
    expect((await prisma.kudos.findUnique({ where: { id } }))?.isVisible).toBe(false);

    const restored = await admin.agent
      .post(`/api/v1/admin/kudos/${id}/moderation`)
      .set("Origin", origin)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ action: "restore", reason: "Reviewed and approved." });
    expect(restored.status).toBe(200);
    expect((await prisma.kudos.findUnique({ where: { id } }))?.isVisible).toBe(true);

    const deleted = await admin.agent
      .delete(`/api/v1/admin/kudos/${id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ reason: "Requested removal." });
    expect(deleted.status).toBe(204);
    expect(await prisma.kudos.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.moderationAudit.count({ where: { kudosId: id, action: "DELETE" } })).toBe(1);
    expect(await prisma.moderationAudit.count({ where: { kudosId: id, action: "RESTORE" } })).toBe(1);
  });

  it("filters inactive colleagues and safely rejects untrusted origins", async () => {
    const sender = await createAccount("sender@example.test");
    const activeRecipient = await createAccount("active@example.test");
    const inactive = await createAccount("inactive@example.test");
    await prisma.user.update({ where: { id: inactive.id }, data: { active: false } });

    const search = await sender.agent.get("/api/v1/users/search?q=act");
    expect(search.status).toBe(200);
    expect(search.body.items.map((item: { id: string }) => item.id)).toContain(activeRecipient.id);
    expect(search.body.items.map((item: { id: string }) => item.id)).not.toContain(sender.id);
    expect(search.body.items.map((item: { id: string }) => item.id)).not.toContain(inactive.id);

    const foreignOrigin = await sender.agent
      .post("/api/auth/logout")
      .set("Origin", "https://evil.example")
      .set("X-CSRF-Token", sender.csrfToken);
    expect(foreignOrigin.status).toBe(403);
  });

  it("returns safe errors for malformed JSON and unknown API routes", async () => {
    const malformed = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .set("Content-Type", "application/json")
      .send("{");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("malformed_json");

    const missing = await request(app).get("/api/not-a-route");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
  });
});
