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
    has_dashboard BOOLEAN;
    has_table_meta BOOLEAN;
    select_sql TEXT := '';
    insert_sql TEXT;
    first_select BOOLEAN := FALSE;
BEGIN
    -- Check for tables existence with schema filter
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'app' AND table_schema = current_schema()) INTO has_app;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow' AND table_schema = current_schema()) INTO has_workflow;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dashboard' AND table_schema = current_schema()) INTO has_dashboard;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'table_meta' AND table_schema = current_schema()) INTO has_table_meta;

    -- 1. Build select SQL for all resources
    -- dashboard and app: sort by last_modified_time DESC (newer first), use negative epoch
    -- workflow and table_meta: sort by order ASC (smaller first)
    IF has_dashboard THEN
        select_sql := 'SELECT base_id, ''dashboard'' as resource_type, id as resource_id, created_time, last_modified_time, -COALESCE(EXTRACT(EPOCH FROM last_modified_time), 0) as sort_value FROM "dashboard"';
        first_select := TRUE;
    END IF;

    IF has_app THEN
        IF first_select THEN
            select_sql := select_sql || ' UNION ALL ';
        END IF;
        select_sql := select_sql || 'SELECT base_id, ''app'' as resource_type, id as resource_id, created_time, last_modified_time, -COALESCE(EXTRACT(EPOCH FROM last_modified_time), 0) as sort_value FROM "app" WHERE deleted_time IS NULL';
        first_select := TRUE;
    END IF;

    IF has_workflow THEN
        IF first_select THEN
            select_sql := select_sql || ' UNION ALL ';
        END IF;
        select_sql := select_sql || 'SELECT base_id, ''workflow'' as resource_type, id as resource_id, created_time, last_modified_time, COALESCE("order", 0) as sort_value FROM "workflow" WHERE deleted_time IS NULL';
        first_select := TRUE;
    END IF;

    IF has_table_meta THEN
        IF first_select THEN
            select_sql := select_sql || ' UNION ALL ';
        END IF;
        select_sql := select_sql || 'SELECT base_id, ''table'' as resource_type, id as resource_id, created_time, last_modified_time, COALESCE("order", 0) as sort_value FROM "table_meta" WHERE deleted_time IS NULL';
        first_select := TRUE;
    END IF;

    -- 2. Build insert SQL with the select query
    IF first_select THEN
        insert_sql := '
        INSERT INTO "base_node" ("id", "base_id", "resource_type", "resource_id", "order", "created_by", "created_time", "last_modified_time")
        SELECT
            gen_random_uuid(),
            base_id,
            resource_type,
            resource_id,
            row_number() OVER (PARTITION BY base_id ORDER BY resource_type, sort_value ASC NULLS LAST),
            ''anonymous'',
            created_time,
            last_modified_time
        FROM (' || select_sql || ') as all_resources';

        EXECUTE insert_sql;
    END IF;
END $$;