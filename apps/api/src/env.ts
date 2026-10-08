import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
dotenv.config({ path: resolve(workspaceRoot, ".env") });

if (!process.env.KUDOS_SESSION_SECRET || process.env.KUDOS_SESSION_SECRET.length < 32) {
  throw new Error("KUDOS_SESSION_SECRET must be configured with at least 32 characters.");
}
