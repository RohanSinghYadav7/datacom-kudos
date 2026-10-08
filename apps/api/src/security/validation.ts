import { z } from "zod";

export const MESSAGE_MAX_CODE_POINTS = 500;
export const MAX_MODERATION_REASON_LENGTH = 500;

export function countCodePoints(value: string): number {
  return Array.from(value).length;
}

export const registrationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().trim().max(254),
  password: z.string().min(12).max(128),
}).strict();

export const loginSchema = z.object({
  email: z.email().trim().max(254),
  password: z.string().min(1).max(128),
}).strict();

export const createKudosSchema = z.object({
  recipientUserId: z.string().min(1).max(64),
  message: z.string(),
}).strict();

export const moderationSchema = z.object({
  action: z.enum(["hide", "restore"]),
  reason: z.string().trim().min(1).max(MAX_MODERATION_REASON_LENGTH),
}).strict();

export const deleteModerationSchema = z.object({
  reason: z.string().trim().min(1).max(MAX_MODERATION_REASON_LENGTH),
}).strict();

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeMessage(message: string): string {
  return message.trim();
}
