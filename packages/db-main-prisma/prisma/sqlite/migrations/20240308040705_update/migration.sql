/*
  Warnings:

  - You are about to drop the column `deleted_time` on the `attachments_table` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `provider_id` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "access_token" ADD COLUMN "last_modified_time" DATETIME;

-- AlterTable
ALTER TABLE "invitation" ADD COLUMN "last_modified_by" TEXT;
ALTER TABLE "invitation" ADD COLUMN "last_modified_time" DATETIME;

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_field" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "is_pending" BOOLEAN,
    "has_error" BOOLEAN,
    "lookup_linked_field_id" TEXT,
    "lookup_options" TEXT,
    "table_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT,
    CONSTRAINT "field_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_field" ("cell_value_type", "created_by", "created_time", "db_field_name", "db_field_type", "deleted_time", "description", "has_error", "id", "is_computed", "is_lookup", "is_multiple_cell_value", "is_pending", "is_primary", "last_modified_by", "last_modified_time", "lookup_linked_field_id", "lookup_options", "name", "not_null", "options", "table_id", "type", "unique", "version") SELECT "cell_value_type", "created_by", "created_time", "db_field_name", "db_field_type", "deleted_time", "description", "has_error", "id", "is_computed", "is_lookup", "is_multiple_cell_value", "is_pending", "is_primary", "last_modified_by", "last_modified_time", "lookup_linked_field_id", "lookup_options", "name", "not_null", "options", "table_id", "type", "unique", "version" FROM "field";
DROP TABLE "field";
ALTER TABLE "new_field" RENAME TO "field";
CREATE INDEX "field_lookup_linked_field_id_idx" ON "field"("lookup_linked_field_id");
CREATE TABLE "new_attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bucket" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimetype" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "deleted_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT
);
INSERT INTO "new_attachments" ("bucket", "created_by", "created_time", "deleted_time", "hash", "height", "id", "last_modified_by", "mimetype", "path", "size", "token", "width") SELECT "bucket", "created_by", "created_time", "deleted_time", "hash", "height", "id", "last_modified_by", "mimetype", "path", "size", "token", "width" FROM "attachments";
DROP TABLE "attachments";
ALTER TABLE "new_attachments" RENAME TO "attachments";
CREATE UNIQUE INDEX "attachments_token_key" ON "attachments"("token");
CREATE TABLE "new_attachments_table" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attachment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT,
    "last_modified_time" DATETIME
);
INSERT INTO "new_attachments_table" ("attachment_id", "created_by", "created_time", "field_id", "id", "last_modified_by", "name", "record_id", "table_id", "token") SELECT "attachment_id", "created_by", "created_time", "field_id", "id", "last_modified_by", "name", "record_id", "table_id", "token" FROM "attachments_table";
DROP TABLE "attachments_table";
ALTER TABLE "new_attachments_table" RENAME TO "attachments_table";
CREATE TABLE "new_automation_workflow_trigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "description" TEXT,
    "trigger_type" TEXT,
    "input_expressions" TEXT,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT
);
INSERT INTO "new_automation_workflow_trigger" ("created_by", "created_time", "deleted_time", "description", "id", "input_expressions", "last_modified_by", "last_modified_time", "trigger_id", "trigger_type", "workflow_id") SELECT "created_by", "created_time", "deleted_time", "description", "id", "input_expressions", "last_modified_by", "last_modified_time", "trigger_id", "trigger_type", "workflow_id" FROM "automation_workflow_trigger";
DROP TABLE "automation_workflow_trigger";
ALTER TABLE "new_automation_workflow_trigger" RENAME TO "automation_workflow_trigger";
CREATE UNIQUE INDEX "automation_workflow_trigger_trigger_id_key" ON "automation_workflow_trigger"("trigger_id");
CREATE INDEX "automation_workflow_trigger_workflow_id_idx" ON "automation_workflow_trigger"("workflow_id");
CREATE TABLE "new_view" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "table_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sort" TEXT,
    "filter" TEXT,
    "group" TEXT,
    "options" TEXT,
    "order" REAL NOT NULL,
    "version" INTEGER NOT NULL,
    "column_meta" TEXT NOT NULL,
    "enable_share" BOOLEAN,
    "share_id" TEXT,
    "share_meta" TEXT,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT,
    CONSTRAINT "view_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_view" ("column_meta", "created_by", "created_time", "deleted_time", "description", "enable_share", "filter", "group", "id", "last_modified_by", "last_modified_time", "name", "options", "order", "share_id", "share_meta", "sort", "table_id", "type", "version") SELECT "column_meta", "created_by", "created_time", "deleted_time", "description", "enable_share", "filter", "group", "id", "last_modified_by", "last_modified_time", "name", "options", "order", "share_id", "share_meta", "sort", "table_id", "type", "version" FROM "view";
DROP TABLE "view";
ALTER TABLE "new_view" RENAME TO "view";
CREATE INDEX "view_order_idx" ON "view"("order");
CREATE TABLE "new_space" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "deleted_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT,
    "last_modified_time" DATETIME
);
INSERT INTO "new_space" ("created_by", "created_time", "deleted_time", "id", "last_modified_by", "name") SELECT "created_by", "created_time", "deleted_time", "id", "last_modified_by", "name" FROM "space";
DROP TABLE "space";
ALTER TABLE "new_space" RENAME TO "space";
CREATE TABLE "new_automation_workflow_action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "description" TEXT,
    "action_type" TEXT,
    "input_expressions" TEXT,
    "next_node_id" TEXT,
    "parent_node_id" TEXT,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT
);
INSERT INTO "new_automation_workflow_action" ("action_id", "action_type", "created_by", "created_time", "deleted_time", "description", "id", "input_expressions", "last_modified_by", "last_modified_time", "next_node_id", "parent_node_id", "workflow_id") SELECT "action_id", "action_type", "created_by", "created_time", "deleted_time", "description", "id", "input_expressions", "last_modified_by", "last_modified_time", "next_node_id", "parent_node_id", "workflow_id" FROM "automation_workflow_action";
DROP TABLE "automation_workflow_action";
ALTER TABLE "new_automation_workflow_action" RENAME TO "automation_workflow_action";
CREATE UNIQUE INDEX "automation_workflow_action_action_id_key" ON "automation_workflow_action"("action_id");
CREATE INDEX "automation_workflow_action_workflow_id_idx" ON "automation_workflow_action"("workflow_id");
CREATE TABLE "new_base" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "space_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" REAL NOT NULL,
    "icon" TEXT,
    "schema_pass" TEXT,
    "deleted_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT,
    "last_modified_time" DATETIME,
    CONSTRAINT "base_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_base" ("created_by", "created_time", "deleted_time", "icon", "id", "last_modified_by", "name", "order", "schema_pass", "space_id") SELECT "created_by", "created_time", "deleted_time", "icon", "id", "last_modified_by", "name", "order", "schema_pass", "space_id" FROM "base";
DROP TABLE "base";
ALTER TABLE "new_base" RENAME TO "base";
CREATE INDEX "base_order_idx" ON "base"("order");
CREATE TABLE "new_automation_workflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deployment_status" TEXT NOT NULL DEFAULT 'undeployed',
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT
);
INSERT INTO "new_automation_workflow" ("created_by", "created_time", "deleted_time", "deployment_status", "description", "id", "last_modified_by", "last_modified_time", "name", "workflow_id") SELECT "created_by", "created_time", "deleted_time", "deployment_status", "description", "id", "last_modified_by", "last_modified_time", "name", "workflow_id" FROM "automation_workflow";
DROP TABLE "automation_workflow";
ALTER TABLE "new_automation_workflow" RENAME TO "automation_workflow";
CREATE UNIQUE INDEX "automation_workflow_workflow_id_key" ON "automation_workflow"("workflow_id");
CREATE TABLE "new_collaborator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role_name" TEXT NOT NULL,
    "base_id" TEXT,
    "space_id" TEXT,
    "user_id" TEXT NOT NULL,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "last_modified_by" TEXT
);
INSERT INTO "new_collaborator" ("base_id", "created_by", "created_time", "deleted_time", "id", "last_modified_by", "last_modified_time", "role_name", "space_id", "user_id") SELECT "base_id", "created_by", "created_time", "deleted_time", "id", "last_modified_by", "last_modified_time", "role_name", "space_id", "user_id" FROM "collaborator";
DROP TABLE "collaborator";
ALTER TABLE "new_collaborator" RENAME TO "collaborator";
CREATE TABLE "new_table_meta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "db_table_name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "order" REAL NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT,
    CONSTRAINT "table_meta_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "base" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_table_meta" ("base_id", "created_by", "created_time", "db_table_name", "deleted_time", "description", "icon", "id", "last_modified_by", "last_modified_time", "name", "order", "version") SELECT "base_id", "created_by", "created_time", "db_table_name", "deleted_time", "description", "icon", "id", "last_modified_by", "last_modified_time", "name", "order", "version" FROM "table_meta";
DROP TABLE "table_meta";
ALTER TABLE "new_table_meta" RENAME TO "table_meta";
CREATE INDEX "table_meta_order_idx" ON "table_meta"("order");
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "password" TEXT,
    "salt" TEXT,
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "avatar" TEXT,
    "notify_meta" TEXT,
    "last_sign_time" DATETIME,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_time" DATETIME,
    "last_modified_time" DATETIME
);
INSERT INTO "new_users" ("avatar", "created_time", "deleted_time", "email", "id", "last_modified_time", "last_sign_time", "name", "notify_meta", "password", "phone", "salt") SELECT "avatar", "created_time", "deleted_time", "email", "id", "last_modified_time", "last_sign_time", "name", "notify_meta", "password", "phone", "salt" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_provider_id_key" ON "account"("provider", "provider_id");
