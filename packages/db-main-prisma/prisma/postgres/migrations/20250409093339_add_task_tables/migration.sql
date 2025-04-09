-- AlterTable
ALTER TABLE "field" ADD COLUMN     "ai_config" TEXT;

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snapshot" TEXT,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_run" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "spent" INTEGER,
    "error_msg" TEXT,
    "started_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3),

    CONSTRAINT "task_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_reference" (
    "id" TEXT NOT NULL,
    "from_field_id" TEXT NOT NULL,
    "to_field_id" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_reference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_type_status_idx" ON "task"("type", "status");

-- CreateIndex
CREATE INDEX "task_run_task_id_status_idx" ON "task_run"("task_id", "status");

-- CreateIndex
CREATE INDEX "task_reference_from_field_id_idx" ON "task_reference"("from_field_id");

-- CreateIndex
CREATE INDEX "task_reference_to_field_id_idx" ON "task_reference"("to_field_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_reference_to_field_id_from_field_id_key" ON "task_reference"("to_field_id", "from_field_id");

-- AddForeignKey
ALTER TABLE "task_run" ADD CONSTRAINT "task_run_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
