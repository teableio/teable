-- Per-user base ordering (T7235): one row per (user, base) once the user has rearranged a
-- space. Real foreign keys with ON DELETE CASCADE keep it consistent without listeners.
-- New, empty table: the FK constraints validate nothing and take only a brief lock on
-- "users" / "base". Re-runnable.

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_base_order" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "order" DOUBLE PRECISION NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3),

    CONSTRAINT "user_base_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_base_order_user_id_base_id_key" ON "user_base_order"("user_id", "base_id");
CREATE INDEX IF NOT EXISTS "user_base_order_user_id_order_idx" ON "user_base_order"("user_id", "order");
CREATE INDEX IF NOT EXISTS "user_base_order_base_id_idx" ON "user_base_order"("base_id");

-- AddForeignKey
ALTER TABLE "user_base_order" DROP CONSTRAINT IF EXISTS "user_base_order_user_id_fkey";
ALTER TABLE "user_base_order" ADD CONSTRAINT "user_base_order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_base_order" DROP CONSTRAINT IF EXISTS "user_base_order_base_id_fkey";
ALTER TABLE "user_base_order" ADD CONSTRAINT "user_base_order_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "base"("id") ON DELETE CASCADE ON UPDATE CASCADE;
