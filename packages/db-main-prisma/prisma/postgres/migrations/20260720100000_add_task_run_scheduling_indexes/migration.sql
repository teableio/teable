-- CreateIndex (status leads for the watchdog skip-scan; base_id for the top-up scans)
CREATE INDEX IF NOT EXISTS "task_run_status_base_id_created_time_idx" ON "task_run"("status", "base_id", "created_time");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "task_run_status_last_modified_time_idx" ON "task_run"("status", "last_modified_time");
