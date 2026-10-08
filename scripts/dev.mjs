import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const apiCli = resolve(root, "node_modules/tsx/dist/cli.mjs");
const viteCli = resolve(root, "node_modules/vite/bin/vite.js");

for (const cli of [apiCli, viteCli]) {
  if (!existsSync(cli)) throw new Error(`Development dependency not found: ${cli}`);
}

const children = [
  spawn(process.execPath, [apiCli, "watch", "src/index.ts"], {
    cwd: resolve(root, "apps/api"),
    env: process.env,
    stdio: "inherit",
  }),
  spawn(process.execPath, [viteCli], {
    cwd: resolve(root, "apps/web"),
    env: process.env,
    stdio: "inherit",
  }),
];
let stopping = false;

function stopChildren(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => stopChildren("SIGINT"));
process.on("SIGTERM", () => stopChildren("SIGTERM"));

for (const child of children) {
  child.on("error", (error) => {
    console.error("Could not start a development process.", error);
    process.exitCode = 1;
    stopChildren();
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    process.exitCode = code ?? (signal ? 1 : 0);
    stopChildren();
  });
}
