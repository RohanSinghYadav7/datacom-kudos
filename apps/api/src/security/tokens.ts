import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const secret = (): string => process.env.KUDOS_SESSION_SECRET!;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createCursor(createdAt: Date, id: string): string {
  const payload = Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readCursor(cursor: string): { createdAt: Date; id: string } | null {
  if (cursor.length > 512) return null;
  const [payload, suppliedSignature, ...extra] = cursor.split(".");
  if (!payload || !suppliedSignature || extra.length > 0) return null;

  const expectedSignature = createHmac("sha256", secret()).update(payload).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expectedSignature.length || !timingSafeEqual(provided, expectedSignature)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !("createdAt" in parsed) || !("id" in parsed)) return null;
    const { createdAt, id } = parsed as { createdAt: unknown; id: unknown };
    if (typeof createdAt !== "string" || typeof id !== "string" || id.length === 0) return null;
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== createdAt) return null;
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

export function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
