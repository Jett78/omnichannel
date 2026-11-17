-- CreateEnum
CREATE TYPE "ConversationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "priority" "ConversationPriority",
ADD COLUMN     "snoozedUntil" TIMESTAMP(3);
