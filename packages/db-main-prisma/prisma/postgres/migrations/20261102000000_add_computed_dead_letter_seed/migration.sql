-- Durable current-stage rerun input; older archives remain explicitly unversioned.
CREATE TABLE "computed_update_dead_letter_seed" (
  "task_id" TEXT NOT NULL,
  "table_id" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  CONSTRAINT "computed_update_dead_letter_seed_pkey" PRIMARY KEY ("task_id", "table_id", "record_id"),
  CONSTRAINT "computed_update_dead_letter_seed_task_id_fkey" FOREIGN KEY ("task_id")
    REFERENCES "computed_update_dead_letter"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
