-- AlterEnum
ALTER TYPE "Provider" ADD VALUE 'MOCK';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "metadata" JSONB;

