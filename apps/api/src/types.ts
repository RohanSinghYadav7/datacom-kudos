import type { User } from "@prisma/client";
import type { Request } from "express";

export type PublicUser = Pick<User, "id" | "name" | "email" | "role">;

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
      csrfToken?: string;
      requestId?: string;
    }
  }
}

export type AuthRequest = Request & { authUser: AuthenticatedUser; csrfToken: string };
