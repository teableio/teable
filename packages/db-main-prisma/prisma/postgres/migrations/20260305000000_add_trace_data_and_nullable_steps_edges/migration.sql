-- AlterTable
ALTER TABLE "computed_update_dead_letter" ADD COLUMN     "trace_data" JSONB,
ALTER COLUMN "steps" DROP NOT NULL,
ALTER COLUMN "edges" DROP NOT NULL;

-- AlterTable
ALTER TABLE "computed_update_outbox" ALTER COLUMN "steps" DROP NOT NULL,
ALTER COLUMN "edges" DROP NOT NULL;
