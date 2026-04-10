CREATE TABLE "computed_update_pause_scope" (
    "id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "paused_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paused_by" TEXT,
    "resume_at" TIMESTAMP(3),
    "reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "computed_update_pause_scope_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "computed_update_pause_scope_scope_type_check" CHECK ("scope_type" IN ('space', 'base', 'table'))
);

CREATE UNIQUE INDEX "computed_update_pause_scope_scope_type_scope_id_key"
ON "computed_update_pause_scope"("scope_type", "scope_id");

CREATE INDEX "computed_update_pause_scope_resume_at_idx"
ON "computed_update_pause_scope"("resume_at");
