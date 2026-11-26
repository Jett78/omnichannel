-- Knowledge documents belong to a knowledge entry (Jeet, 2026-11-26):
-- each entry holds a title, facts and its own documents, Dograh-style.
-- Nullable: documents uploaded before entries existed stay unattached.
ALTER TABLE "KnowledgeDocument" ADD COLUMN "entryId" TEXT;

ALTER TABLE "KnowledgeDocument"
  ADD CONSTRAINT "KnowledgeDocument_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "KnowledgeEntry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "KnowledgeDocument_entryId_idx" ON "KnowledgeDocument"("entryId");
