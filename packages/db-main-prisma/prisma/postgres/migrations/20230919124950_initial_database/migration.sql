-- CreateTable
CREATE TABLE "space" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deleted_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,

    CONSTRAINT "space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base" (
    "id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" DOUBLE PRECISION NOT NULL,
    "icon" TEXT,
    "deleted_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,

    CONSTRAINT "base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_meta" (
    "id" TEXT NOT NULL,
    "base_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "db_table_name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "order" DOUBLE PRECISION NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3) NOT NULL,
    "deleted_time" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,

    CONSTRAINT "table_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "options" TEXT,
    "type" TEXT NOT NULL,
    "cell_value_type" TEXT NOT NULL,
    "is_multiple_cell_value" BOOLEAN,
    "db_field_type" TEXT NOT NULL,
    "db_field_name" TEXT NOT NULL,
    "not_null" BOOLEAN,
    "unique" BOOLEAN,
    "is_primary" BOOLEAN,
    "is_computed" BOOLEAN,
    "is_lookup" BOOLEAN,
    "has_error" BOOLEAN,
    "lookup_linked_field_id" TEXT,
    "lookup_options" TEXT,
    "table_id" TEXT NOT NULL,
    "column_meta" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3) NOT NULL,
    "deleted_time" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,

    CONSTRAINT "field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "view" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "table_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sort" TEXT,
    "filter" TEXT,
    "group" TEXT,
    "options" TEXT,
    "order" DOUBLE PRECISION NOT NULL,
    "version" INTEGER NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3) NOT NULL,
    "deleted_time" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,

    CONSTRAINT "view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops" (
    "collection" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "snapshots" (
    "collection" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "reference" (
    "id" TEXT NOT NULL,
    "from_field_id" TEXT NOT NULL,
    "to_field_id" TEXT NOT NULL,

    CONSTRAINT "reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT,
    "salt" TEXT,
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "avatar" TEXT,
    "provider" TEXT,
    "provider_id" TEXT,
    "last_sign_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_time" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_modified_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimetype" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "deleted_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments_table" (
    "id" TEXT NOT NULL,
    "attachment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "deleted_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,

    CONSTRAINT "attachments_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_workflow" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deployment_status" TEXT NOT NULL DEFAULT 'undeployed',
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3) NOT NULL,
    "deleted_time" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,

    CONSTRAINT "automation_workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_workflow_trigger" (
    "id" TEXT NOT NULL,
    "trigger_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "description" TEXT,
    "trigger_type" TEXT,
    "input_expressions" TEXT,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3) NOT NULL,
    "deleted_time" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,

    CONSTRAINT "automation_workflow_trigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_workflow_action" (
    "id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "description" TEXT,
    "action_type" TEXT,
    "input_expressions" TEXT,
    "next_node_id" TEXT,
    "parent_node_id" TEXT,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" TIMESTAMP(3) NOT NULL,
    "deleted_time" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL,

    CONSTRAINT "automation_workflow_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_workflow_execution_history" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "execution_type" TEXT NOT NULL,
    "execution_result" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_workflow_execution_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "base_order_idx" ON "base"("order");

-- CreateIndex
CREATE INDEX "table_meta_order_idx" ON "table_meta"("order");

-- CreateIndex
CREATE INDEX "field_lookup_linked_field_id_idx" ON "field"("lookup_linked_field_id");

-- CreateIndex
CREATE INDEX "view_order_idx" ON "view"("order");

-- CreateIndex
CREATE INDEX "ops_collection_created_time_idx" ON "ops"("collection", "created_time");

-- CreateIndex
CREATE UNIQUE INDEX "ops_collection_doc_id_version_key" ON "ops"("collection", "doc_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "snapshots_collection_doc_id_key" ON "snapshots"("collection", "doc_id");

-- CreateIndex
CREATE INDEX "reference_from_field_id_idx" ON "reference"("from_field_id");

-- CreateIndex
CREATE INDEX "reference_to_field_id_idx" ON "reference"("to_field_id");

-- CreateIndex
CREATE INDEX "reference_to_field_id_from_field_id_idx" ON "reference"("to_field_id", "from_field_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_provider_provider_id_key" ON "users"("provider", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_token_key" ON "attachments"("token");

-- CreateIndex
CREATE UNIQUE INDEX "automation_workflow_workflow_id_key" ON "automation_workflow"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_workflow_trigger_trigger_id_key" ON "automation_workflow_trigger"("trigger_id");

-- CreateIndex
CREATE INDEX "automation_workflow_trigger_workflow_id_idx" ON "automation_workflow_trigger"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_workflow_action_action_id_key" ON "automation_workflow_action"("action_id");

-- CreateIndex
CREATE INDEX "automation_workflow_action_workflow_id_idx" ON "automation_workflow_action"("workflow_id");

-- CreateIndex
CREATE INDEX "automation_workflow_execution_history_workflow_id_idx" ON "automation_workflow_execution_history"("workflow_id");

-- AddForeignKey
ALTER TABLE "base" ADD CONSTRAINT "base_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_meta" ADD CONSTRAINT "table_meta_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "base"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field" ADD CONSTRAINT "field_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "view" ADD CONSTRAINT "view_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
