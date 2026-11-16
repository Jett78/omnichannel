-- CreateTable
CREATE TABLE "OAuthConnectionSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "stateHash" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthConnectionSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthConnectionSession_stateHash_key" ON "OAuthConnectionSession"("stateHash");

-- CreateIndex
CREATE INDEX "OAuthConnectionSession_workspaceId_userId_idx" ON "OAuthConnectionSession"("workspaceId", "userId");

-- AddForeignKey
ALTER TABLE "OAuthConnectionSession" ADD CONSTRAINT "OAuthConnectionSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthConnectionSession" ADD CONSTRAINT "OAuthConnectionSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

