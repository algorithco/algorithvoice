-- Add BillingInterval for Pro monthly/yearly. Backfills from stripePriceId when
-- possible; otherwise leaves NULL and lets the next Stripe webhook sync it.
-- Generated pattern follows 1_add_user_role_and_ai_tables/migration.sql.

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "billingInterval" "BillingInterval";
