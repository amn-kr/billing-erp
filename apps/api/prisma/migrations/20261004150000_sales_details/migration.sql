-- AlterTable
ALTER TABLE "payment_allocations" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'document',
ADD COLUMN     "party_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "source_id" UUID,
ADD COLUMN     "splits" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "sales_document_lines" ADD COLUMN     "base_price" DECIMAL(14,2),
ADD COLUMN     "comm_override" JSONB,
ALTER COLUMN "disc_pct" SET DATA TYPE DECIMAL(12,8);

-- AlterTable
ALTER TABLE "sales_documents" ADD COLUMN     "extra" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_kind CHECK (kind IN ('document', 'opening'));
