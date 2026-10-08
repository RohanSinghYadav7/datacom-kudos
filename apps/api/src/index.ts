import "./env.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { prisma } from "./db.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(currentDirectory, "../../../");
const webDist = resolve(workspaceRoot, "apps/web/dist");
const app = createApp();
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

if (existsSync(webDist)) {
  app.use(express.static(webDist, {
    index: false,
    setHeaders(response) {
      response.setHeader("Content-Security-Policy", contentSecurityPolicy);
    },
  }));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      res.setHeader("Content-Security-Policy", contentSecurityPolicy);
      res.sendFile(resolve(webDist, "index.html"), (error) => {
        if (error) next(error);
      });
      return;
    }
    next();
  });
}

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const server = app.listen(port, () => {
  console.info(`Kudos API listening on port ${port}`);
});

async function shutdown(): Promise<void> {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
