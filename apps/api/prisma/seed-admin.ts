import "../src/env.js";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/security/password.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.KUDOS_ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.KUDOS_ADMIN_NAME?.trim();
  const password = process.env.KUDOS_ADMIN_PASSWORD;

  if (!email || !name || !password) {
    throw new Error("Set KUDOS_ADMIN_EMAIL, KUDOS_ADMIN_NAME, and KUDOS_ADMIN_PASSWORD.");
  }
  if (password.length < 12) {
    throw new Error("KUDOS_ADMIN_PASSWORD must be at least 12 characters.");
  }

  const passwordHash = await hashPassword(password);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { name, passwordHash, role: "ADMIN", active: true },
    });
    console.info(`Updated admin account: ${email}`);
  } else {
    await prisma.user.create({
      data: { email, name, passwordHash, role: "ADMIN" },
    });
    console.info(`Created admin account: ${email}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("Admin bootstrap failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
