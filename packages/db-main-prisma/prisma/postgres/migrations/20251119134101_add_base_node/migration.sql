-- CreateTable
CREATE TABLE "base_node" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT,
    "base_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "order" DOUBLE PRECISION NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" TIMESTAMP(3),
    "last_modified_by" TEXT,

    CONSTRAINT "base_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base_node_folder" (
    "id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" TIMESTAMP(3),
    "last_modified_by" TEXT,

    CONSTRAINT "base_node_folder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "base_node_base_id_resource_type_resource_id_key" ON "base_node"("base_id", "resource_type", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "base_node_folder_base_id_name_key" ON "base_node_folder"("base_id", "name");

-- AddForeignKey
ALTER TABLE "base_node" ADD CONSTRAINT "base_node_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "base_node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data Migration
DO $$
DECLARE
    has_app BOOLEAN;
    has_workflow BOOLEAN;
    insert_sql TEXT;
BEGIN
    -- Check for tables existence
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'app') INTO has_app;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow') INTO has_workflow;

    -- 1. Insert existing resources into base_node
    insert_sql := '
    INSERT INTO "base_node" ("id", "base_id", "resource_type", "resource_id", "order", "created_by", "created_time", "last_modified_time")
    SELECT
        gen_random_uuid(),
        base_id,
        resource_type,
        resource_id,
        row_number() OVER (PARTITION BY base_id ORDER BY last_modified_time DESC NULLS LAST, created_time DESC),
        ''anonymous'',
        created_time,
        last_modified_time
    FROM (
        SELECT base_id, ''table'' as resource_type, id as resource_id, created_time, last_modified_time FROM "table_meta" WHERE deleted_time IS NULL
        UNION ALL
        SELECT base_id, ''dashboard'' as resource_type, id as resource_id, created_time, last_modified_time FROM "dashboard"
    ';

    IF has_app THEN
        insert_sql := insert_sql || '
        UNION ALL
        SELECT base_id, ''app'' as resource_type, id as resource_id, created_time, last_modified_time FROM "app" WHERE deleted_time IS NULL
        ';
    END IF;

    IF has_workflow THEN
        insert_sql := insert_sql || '
        UNION ALL
        SELECT base_id, ''workflow'' as resource_type, id as resource_id, created_time, last_modified_time FROM "workflow" WHERE deleted_time IS NULL
        ';
    END IF;

    insert_sql := insert_sql || ') as all_resources';

    EXECUTE insert_sql;

END $$;

-- 2. Create folders and move items (Apps)
WITH apps_to_move AS (
    SELECT DISTINCT base_id
    FROM "base_node"
    WHERE resource_type = 'app'
),
created_folders AS (
    INSERT INTO "base_node_folder" ("id", "base_id", "name", "created_by")
    SELECT gen_random_uuid(), base_id, 'Apps', 'anonymous'
    FROM apps_to_move
    ON CONFLICT ("base_id", "name") DO NOTHING
    RETURNING id, base_id
),
created_node_items AS (
    INSERT INTO "base_node" ("id", "base_id", "resource_type", "resource_id", "order", "created_by")
    SELECT gen_random_uuid(), base_id, 'folder', id, -3, 'anonymous'
    FROM created_folders
    RETURNING id, resource_id, base_id
)
UPDATE "base_node"
SET parent_id = cni.id,
    "order" = row_number() OVER (PARTITION BY "base_node".base_id ORDER BY "base_node"."order")
FROM created_node_items cni
INNER JOIN created_folders cf ON cni.resource_id = cf.id
WHERE "base_node".base_id = cf.base_id
  AND "base_node".resource_type = 'app';

-- 3. Create folders and move items (Workflows)
WITH workflows_to_move AS (
    SELECT DISTINCT base_id
    FROM "base_node"
    WHERE resource_type = 'workflow'
),
created_folders AS (
    INSERT INTO "base_node_folder" ("id", "base_id", "name", "created_by")
    SELECT gen_random_uuid(), base_id, 'Workflows', 'anonymous'
    FROM workflows_to_move
    ON CONFLICT ("base_id", "name") DO NOTHING
    RETURNING id, base_id
),
created_node_items AS (
    INSERT INTO "base_node" ("id", "base_id", "resource_type", "resource_id", "order", "created_by")
    SELECT gen_random_uuid(), base_id, 'folder', id, -2, 'anonymous'
    FROM created_folders
    RETURNING id, resource_id, base_id
)
UPDATE "base_node"
SET parent_id = cni.id,
    "order" = row_number() OVER (PARTITION BY "base_node".base_id ORDER BY "base_node"."order")
FROM created_node_items cni
INNER JOIN created_folders cf ON cni.resource_id = cf.id
WHERE "base_node".base_id = cf.base_id
  AND "base_node".resource_type = 'workflow';

-- 4. Create folders and move items (Dashboards)
WITH dashboards_to_move AS (
    SELECT DISTINCT base_id
    FROM "base_node"
    WHERE resource_type = 'dashboard'
),
created_folders AS (
    INSERT INTO "base_node_folder" ("id", "base_id", "name", "created_by")
    SELECT gen_random_uuid(), base_id, 'Dashboards', 'anonymous'
    FROM dashboards_to_move
    ON CONFLICT ("base_id", "name") DO NOTHING
    RETURNING id, base_id
),
created_node_items AS (
    INSERT INTO "base_node" ("id", "base_id", "resource_type", "resource_id", "order", "created_by")
    SELECT gen_random_uuid(), base_id, 'folder', id, -1, 'anonymous'
    FROM created_folders
    RETURNING id, resource_id, base_id
)
UPDATE "base_node"
SET parent_id = cni.id,
    "order" = row_number() OVER (PARTITION BY "base_node".base_id ORDER BY "base_node"."order")
FROM created_node_items cni
INNER JOIN created_folders cf ON cni.resource_id = cf.id
WHERE "base_node".base_id = cf.base_id
  AND "base_node".resource_type = 'dashboard';
