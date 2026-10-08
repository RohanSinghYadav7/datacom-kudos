export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
};

export type Person = { id: string; name: string };

export type KudosItem = {
  id: string;
  sender: Person;
  recipient: Person;
  message: string;
  createdAt: string;
};

export type AdminKudosItem = KudosItem & {
  isVisible: boolean;
  moderation: {
    moderator: Person | null;
    moderatedAt: string;
    reason: string | null;
  } | null;
};

type ApiErrorPayload = {
  error?: { code?: string; message?: string; field?: string };
  requestId?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  csrfToken?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers, credentials: "include" });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0, "network_error");
  }

  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as ApiErrorPayload | null;
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? "The request could not be completed.",
      response.status,
      payload?.error?.code,
      payload?.error?.field,
    );
  }
  return payload as T;
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
