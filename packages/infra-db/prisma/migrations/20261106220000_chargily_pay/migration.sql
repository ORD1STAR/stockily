-- Chargily Pay: the customer created for an org, and the checkout behind a payment.
ALTER TABLE "organizations" ADD COLUMN "chargilyCustomerId" TEXT;
ALTER TABLE "platform_payments" ADD COLUMN "checkoutId" TEXT, ADD COLUMN "checkoutUrl" TEXT, ADD COLUMN "request" JSONB;
CREATE UNIQUE INDEX "platform_payments_checkoutId_key" ON "platform_payments"("checkoutId");
