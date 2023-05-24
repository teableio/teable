/*
  Warnings:

  - You are about to drop the column `created_at` on the `table_meta` table. All the data in the column will be lost.
  - You are about to drop the column `deleted_at` on the `table_meta` table. All the data in the column will be lost.
  - You are about to drop the column `last_modified_at` on the `table_meta` table. All the data in the column will be lost.
  - Added the required column `last_modified_time` to the `table_meta` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimetype" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "deleted_time" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "automation_workflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deployment_status" TEXT NOT NULL DEFAULT 'undeployed',
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME NOT NULL,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "automation_workflow_trigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "description" TEXT,
    "trigger_type" TEXT,
    "input_expressions" TEXT,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME NOT NULL,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "automation_workflow_action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "description" TEXT,
    "action_type" TEXT,
    "input_expressions" TEXT,
    "next_node_id" TEXT,
    "parent_node_id" TEXT,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME NOT NULL,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "automation_workflow_execution_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "automaion_workflow_id" TEXT NOT NULL,
    "execution_type" TEXT NOT NULL,
    "execution_result" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_table_meta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "db_table_name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "order" REAL NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME NOT NULL,
    "deleted_time" DATETIME,
    "created_by" TEXT NOT NULL,
    "last_modified_by" TEXT NOT NULL
);
INSERT INTO "new_table_meta" ("created_by", "db_table_name", "description", "icon", "id", "last_modified_by", "name", "order", "version") SELECT "created_by", "db_table_name", "description", "icon", "id", "last_modified_by", "name", "order", "version" FROM "table_meta";
DROP TABLE "table_meta";
ALTER TABLE "new_table_meta" RENAME TO "table_meta";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE UNIQUE INDEX "attachments_token_key" ON "attachments"("token");

-- CreateIndex
CREATE UNIQUE INDEX "automation_workflow_workflow_id_key" ON "automation_workflow"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_workflow_trigger_trigger_id_key" ON "automation_workflow_trigger"("trigger_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_workflow_action_action_id_key" ON "automation_workflow_action"("action_id");
