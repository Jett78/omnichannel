-- CreateTable
CREATE TABLE "StoredMedia" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredMedia_attachmentId_key" ON "StoredMedia"("attachmentId");

-- AddForeignKey
ALTER TABLE "StoredMedia" ADD CONSTRAINT "StoredMedia_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "MessageAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
