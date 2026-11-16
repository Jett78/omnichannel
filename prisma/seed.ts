import { hashPassword } from "better-auth/crypto";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

/**
 * DEV-ONLY seed. Creates the demo user THROUGH Better Auth's account
 * model (credential password hashed with better-auth/crypto, exactly
 * what the sign-in flow verifies) plus a demo workspace owned by them.
 *
 * Demo login: demo@uoi.local / demo-password-123
 */
const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://uoi:uoi_password@localhost:5432/uoi?schema=public",
});
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const email = "demo@uoi.local";
  const passwordHash = await hashPassword("demo-password-123");

  const user = await prisma.user.upsert({
    where: { email },
    update: { name: "Demo Owner" },
    create: { email, name: "Demo Owner", emailVerified: true },
  });

  // Better Auth credential account: providerId "credential", accountId = user id.
  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (existingAccount) {
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: { password: passwordHash },
    });
  } else {
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });
  }

  const workspace = await prisma.workspace.upsert({
    where: { slug: "demo-workspace" },
    update: {},
    create: {
      name: "Demo Workspace",
      slug: "demo-workspace",
      timezone: "Asia/Kathmandu",
    },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: { role: "OWNER" },
    create: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
  });

  console.log(`Seeded demo user ${user.email} in workspace ${workspace.slug}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
