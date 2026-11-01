-- Owner panel, part 2 (owner's request, 1 Nov 2026): plans and manual payments. Two plans, "Free trial" and
-- "Paid plan", with no fixed prices: the owner types the amount received for each payment. Activating or renewing
-- a shop's plan in the panel adds a subscription (the period) and its payment (amount, paid by, reference).
-- Additive only: two plan rows, new columns with safe defaults, and the panel's read/add rules on these tables.

INSERT INTO plans (code, name, price_monthly, price_yearly) VALUES ('trial', 'Free trial', 0, 0), ('paid', 'Paid plan', 0, 0)
ON CONFLICT (code) DO NOTHING;

-- how many months the period is (1, 3, 6 or 12)
ALTER TABLE "subscriptions" ADD COLUMN "months" INTEGER NOT NULL DEFAULT 1;
-- the day the money came in, how (UPI, Bank transfer, Cash, Cheque) and its reference (UPI ref, UTR, cheque no.)
ALTER TABLE "subscription_payments" ADD COLUMN "paid_on" DATE;
ALTER TABLE "subscription_payments" ADD COLUMN "paid_by" TEXT NOT NULL DEFAULT '';
ALTER TABLE "subscription_payments" ADD COLUMN "reference" TEXT NOT NULL DEFAULT '';

-- The panel may read and add a shop's subscriptions and payments (never change or remove them).
CREATE POLICY subscriptions_owner_read ON subscriptions FOR SELECT USING (app_owner_admin_id() IS NOT NULL);
CREATE POLICY subscriptions_owner_insert ON subscriptions FOR INSERT WITH CHECK (app_owner_admin_id() IS NOT NULL);
CREATE POLICY subscription_payments_owner_read ON subscription_payments FOR SELECT USING (app_owner_admin_id() IS NOT NULL);
CREATE POLICY subscription_payments_owner_insert ON subscription_payments FOR INSERT WITH CHECK (app_owner_admin_id() IS NOT NULL);

-- their backup triggers write change entries too: the panel's change-entry rule now covers these two tables
DROP POLICY change_log_owner_insert ON change_log;
CREATE POLICY change_log_owner_insert ON change_log FOR INSERT
  WITH CHECK (app_owner_admin_id() IS NOT NULL AND tbl IN ('businesses', 'subscriptions', 'subscription_payments'));

-- To undo: DROP POLICY subscriptions_owner_read ON subscriptions; DROP POLICY subscriptions_owner_insert ON subscriptions;
-- DROP POLICY subscription_payments_owner_read ON subscription_payments; DROP POLICY subscription_payments_owner_insert ON subscription_payments;
-- DROP POLICY change_log_owner_insert ON change_log; CREATE POLICY change_log_owner_insert ON change_log FOR INSERT
--   WITH CHECK (app_owner_admin_id() IS NOT NULL AND tbl = 'businesses');
-- ALTER TABLE subscription_payments DROP COLUMN paid_on, DROP COLUMN paid_by, DROP COLUMN reference;
-- ALTER TABLE subscriptions DROP COLUMN months; DELETE FROM plans WHERE code IN ('trial', 'paid');
