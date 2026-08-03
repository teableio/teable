BEGIN;

-- DropIndex
DROP INDEX "user_last_visit_user_id_resource_type_parent_resource_id_key";

-- fix error: Delete duplicate records before creating unique index
WITH duplicates AS (
  SELECT user_id, resource_type, resource_id, COUNT(*) as count
   FROM user_last_visit
   GROUP BY user_id, resource_type, resource_id
)
DELETE FROM user_last_visit
WHERE (user_id, resource_type, resource_id) IN (
  SELECT user_id, resource_type, resource_id
  FROM duplicates
  WHERE count > 1
);

-- CreateIndex
CREATE INDEX "user_last_visit_user_id_resource_type_parent_resource_id_idx" ON "user_last_visit"("user_id", "resource_type", "parent_resource_id");

CREATE UNIQUE INDEX "user_last_visit_user_id_resource_type_resource_id_key" ON "user_last_visit"("user_id", "resource_type", "resource_id");

COMMIT;
