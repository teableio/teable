PRAGMA foreign_keys=OFF;

CREATE TABLE "new_computed_update_outbox_seed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    CONSTRAINT "computed_update_outbox_seed_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "computed_update_outbox" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_computed_update_outbox_seed" ("id", "task_id", "table_id", "record_id")
SELECT s."id", s."task_id", o."seed_table_id", s."record_id"
FROM "computed_update_outbox_seed" AS s
LEFT JOIN "computed_update_outbox" AS o ON o."id" = s."task_id";

DROP TABLE "computed_update_outbox_seed";
ALTER TABLE "new_computed_update_outbox_seed" RENAME TO "computed_update_outbox_seed";

CREATE INDEX "computed_update_outbox_seed_task_id_idx" ON "computed_update_outbox_seed"("task_id");
CREATE UNIQUE INDEX "computed_update_outbox_seed_task_id_table_id_record_id_key" ON "computed_update_outbox_seed"("task_id", "table_id", "record_id");

PRAGMA foreign_keys=ON;
