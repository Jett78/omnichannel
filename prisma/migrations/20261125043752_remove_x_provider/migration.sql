-- Remove the retired X (Twitter) value from the Provider enum.
-- The X integration was removed from the product (2026-11-25); it was
-- never activatable on this deployment, so no rows use 'X' and the
-- casts below cannot fail on data.
ALTER TYPE "Provider" RENAME TO "Provider_old";
CREATE TYPE "Provider" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'TELEGRAM', 'TIKTOK', 'GMAIL', 'WEBSITE', 'MOCK');
ALTER TABLE "Channel" ALTER COLUMN "provider" TYPE "Provider" USING ("provider"::text::"Provider");
ALTER TABLE "OAuthConnectionSession" ALTER COLUMN "provider" TYPE "Provider" USING ("provider"::text::"Provider");
ALTER TABLE "WebhookEvent" ALTER COLUMN "provider" TYPE "Provider" USING ("provider"::text::"Provider");
DROP TYPE "Provider_old";
