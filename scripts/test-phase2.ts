/**
 * Phase 2 authorization-boundary tests — runs against the REAL database.
 *
 *   npm run test:phase2
 *
 * Covers: cross-workspace isolation, role permission matrix, invitation
 * flow, last-owner guards, admin-vs-owner guard, team permissions, and
 * channel-credential encryption. Prints PASS/FAIL per assertion and
 * exits non-zero on any failure. Test data uses unique emails per run
 * and is deleted at the end.
 */
import { auth } from "@/lib/auth";
import { decryptText, encryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { channelCredentialService } from "@/services/channel-credential.service";
import { workspaceService } from "@/services/workspace.service";

const runId = Date.now().toString(36);
const PASSWORD = "test-password-123";

let passed = 0;
let failed = 0;
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];

function pass(name: string) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name: string, detail?: string) {
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function expectThrows(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    fail(name, "expected an error but none was thrown");
  } catch {
    pass(name);
  }
}

async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `phase2-${label}-${runId}@test.local`;
  const result = await auth.api.signUpEmail({
    body: { name: `Phase2 ${label}`, email, password: PASSWORD },
  });
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email };
}

async function main(): Promise<void> {
  console.log(`Phase 2 tests (run ${runId})\n`);

  // ── Setup: A owns WA, B owns WB ──────────────────────────────────────
  const userA = await signUp("a");
  const userB = await signUp("b");
  const wa = await workspaceService.createWorkspace(userA.id, { name: `WA ${runId}` });
  const wb = await workspaceService.createWorkspace(userB.id, { name: `WB ${runId}` });
  createdWorkspaceIds.push(wa.id, wb.id);
  pass("setup: users A/B signed up via Better Auth, workspaces WA/WB created");

  // Sanity: owners CAN access their own workspace.
  try {
    await workspaceService.getWorkspaceForUser(userA.id, wa.id);
    pass("sanity: A can read own workspace WA");
  } catch (error) {
    fail("sanity: A can read own workspace WA", String(error));
  }

  // ── 1–5. Cross-workspace isolation ───────────────────────────────────
  await expectThrows("B cannot getWorkspaceForUser(WA)", () =>
    workspaceService.getWorkspaceForUser(userB.id, wa.id),
  );
  await expectThrows("B cannot updateWorkspace(WA)", () =>
    workspaceService.updateWorkspace(userB.id, wa.id, { name: "Hijacked" }),
  );
  await expectThrows("B cannot listMembers(WA)", () =>
    workspaceService.listMembers(userB.id, wa.id),
  );
  await expectThrows("B cannot inviteMember(WA)", () =>
    workspaceService.inviteMember(userB.id, wa.id, { email: "x@test.local", role: "AGENT" }),
  );
  await expectThrows("A cannot getWorkspaceForUser(WB)", () =>
    workspaceService.getWorkspaceForUser(userA.id, wb.id),
  );
  await expectThrows("A cannot updateWorkspace(WB)", () =>
    workspaceService.updateWorkspace(userA.id, wb.id, { name: "Hijacked" }),
  );
  await expectThrows("A cannot listTeams(WB)", () =>
    workspaceService.listTeams(userA.id, wb.id),
  );

  // ── 6. Invite C as AGENT into WA; AGENT permissions are limited ─────
  const userC = await signUp("c");
  const { invitation } = await workspaceService.inviteMember(userA.id, wa.id, {
    email: userC.email,
    role: "AGENT",
  });
  pass("OWNER can inviteMember(WA)");

  const acceptResult = await workspaceService.acceptInvitation(userC.id, invitation.token);
  if (acceptResult.workspaceId === wa.id && !acceptResult.alreadyMember) {
    pass("C acceptInvitation joins WA");
  } else {
    fail("C acceptInvitation joins WA", JSON.stringify(acceptResult));
  }

  const cMember = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: wa.id, userId: userC.id } },
  });
  if (cMember?.role === "AGENT") pass("C has AGENT role in WA");
  else fail("C has AGENT role in WA", `role=${cMember?.role ?? "none"}`);

  await expectThrows("AGENT C cannot inviteMember(WA)", () =>
    workspaceService.inviteMember(userC.id, wa.id, { email: "y@test.local", role: "AGENT" }),
  );
  await expectThrows("AGENT C cannot updateWorkspace(WA)", () =>
    workspaceService.updateWorkspace(userC.id, wa.id, { name: "Nope" }),
  );
  await expectThrows("AGENT C cannot createTeam(WA)", () =>
    workspaceService.createTeam(userC.id, wa.id, { name: "Support" }),
  );
  await expectThrows("C still cannot access WB", () =>
    workspaceService.getWorkspaceForUser(userC.id, wb.id),
  );

  // Wrong-email acceptance must fail.
  const { invitation: inviteForC2 } = await workspaceService.inviteMember(userA.id, wa.id, {
    email: `phase2-other-${runId}@test.local`,
    role: "AGENT",
  });
  await expectThrows("C cannot accept an invitation addressed to another email", () =>
    workspaceService.acceptInvitation(userC.id, inviteForC2.token),
  );

  // ── Teams: OWNER can create ──────────────────────────────────────────
  try {
    const team = await workspaceService.createTeam(userA.id, wa.id, { name: `Support ${runId}` });
    if (team.workspaceId === wa.id) pass("OWNER can createTeam(WA)");
    else fail("OWNER can createTeam(WA)", "wrong workspace");
  } catch (error) {
    fail("OWNER can createTeam(WA)", String(error));
  }

  // ── ADMIN vs OWNER guard ─────────────────────────────────────────────
  const userD = await signUp("d");
  const { invitation: inviteD } = await workspaceService.inviteMember(userA.id, wa.id, {
    email: userD.email,
    role: "ADMIN",
  });
  await workspaceService.acceptInvitation(userD.id, inviteD.token);
  const aMember = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: wa.id, userId: userA.id } },
  });
  const dMember = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: wa.id, userId: userD.id } },
  });
  if (!aMember || !dMember) throw new Error("setup: memberships missing");

  await expectThrows("ADMIN cannot change OWNER's role", () =>
    workspaceService.updateMemberRole(userD.id, wa.id, aMember.id, "AGENT"),
  );
  await expectThrows("ADMIN cannot remove OWNER", () =>
    workspaceService.removeMember(userD.id, wa.id, aMember.id),
  );

  // ADMIN *can* manage an AGENT (sanity that the matrix isn't all-deny).
  try {
    await workspaceService.updateMemberRole(userD.id, wa.id, cMember!.id, "VIEWER");
    await workspaceService.updateMemberRole(userD.id, wa.id, cMember!.id, "AGENT");
    pass("ADMIN can change AGENT's role");
  } catch (error) {
    fail("ADMIN can change AGENT's role", String(error));
  }

  // ── Last-OWNER guards ────────────────────────────────────────────────
  await expectThrows("last OWNER cannot be removed", () =>
    workspaceService.removeMember(userA.id, wa.id, aMember.id),
  );
  await expectThrows("last OWNER cannot be demoted", () =>
    workspaceService.updateMemberRole(userA.id, wa.id, aMember.id, "ADMIN"),
  );

  // ── Encryption + credential service ──────────────────────────────────
  const ciphertext = encryptText("super-secret-token");
  if (ciphertext !== "super-secret-token" && decryptText(ciphertext) === "super-secret-token") {
    pass("encryption roundtrip (AES-256-GCM)");
  } else {
    fail("encryption roundtrip (AES-256-GCM)");
  }

  const channel = await prisma.channel.create({
    data: {
      workspaceId: wa.id,
      provider: "TELEGRAM",
      externalAccountId: `test-bot-${runId}`,
      displayName: "Test Bot",
    },
  });
  const meta = await channelCredentialService.setChannelCredential(userA.id, wa.id, channel.id, {
    accessToken: "plain-access-token-123",
    refreshToken: "plain-refresh-token-456",
    scopes: ["messages"],
  });
  const stored = await prisma.channelCredential.findUnique({ where: { channelId: channel.id } });
  if (stored && stored.encryptedAccessToken !== "plain-access-token-123") {
    pass("credential stored as ciphertext, not plaintext");
  } else {
    fail("credential stored as ciphertext, not plaintext");
  }
  const metaRecord = meta as unknown as Record<string, unknown>;
  if (
    meta.hasToken === true &&
    !("accessToken" in metaRecord) &&
    !("encryptedAccessToken" in metaRecord) &&
    JSON.stringify(meta).includes("plain-access-token") === false
  ) {
    pass("credential meta exposes no token material");
  } else {
    fail("credential meta exposes no token material", JSON.stringify(meta));
  }
  const decrypted = await channelCredentialService.getDecryptedChannelCredentialForServer(
    channel.id,
  );
  if (decrypted?.accessToken === "plain-access-token-123") {
    pass("server-side decrypt returns the original token");
  } else {
    fail("server-side decrypt returns the original token");
  }
  await expectThrows("B cannot set credential on WA channel", () =>
    channelCredentialService.setChannelCredential(userB.id, wa.id, channel.id, {
      accessToken: "evil",
    }),
  );

  // ── Cleanup ──────────────────────────────────────────────────────────
  await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  console.log("\nCleanup done (workspaces + users deleted).");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((error: unknown) => {
    console.error("Test run crashed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
