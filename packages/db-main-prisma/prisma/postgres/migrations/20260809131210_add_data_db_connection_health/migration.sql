-- CreateEnum
CREATE TYPE "DataDbConnectionHealthState" AS ENUM ('healthy', 'read_only', 'unreachable', 'degraded');

-- AlterTable
ALTER TABLE "data_db_connection" ADD COLUMN     "consecutive_health_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "health_changed_at" TIMESTAMP(3),
ADD COLUMN     "health_reason" TEXT,
ADD COLUMN     "health_state" "DataDbConnectionHealthState" NOT NULL DEFAULT 'healthy',
ADD COLUMN     "last_health_check_at" TIMESTAMP(3);
