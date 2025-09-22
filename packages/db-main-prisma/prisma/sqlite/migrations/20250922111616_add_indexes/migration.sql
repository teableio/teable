-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ops" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL
);
INSERT INTO "new_ops" ("collection", "created_by", "created_time", "doc_id", "doc_type", "id", "operation", "version") SELECT "collection", "created_by", "created_time", "doc_id", "doc_type", "id", "operation", "version" FROM "ops";
DROP TABLE "ops";
ALTER TABLE "new_ops" RENAME TO "ops";
CREATE INDEX "ops_collection_created_time_idx" ON "ops"("collection", "created_time");
CREATE UNIQUE INDEX "ops_collection_doc_id_version_key" ON "ops"("collection", "doc_id", "version");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "access_token_user_id_idx" ON "access_token"("user_id");

-- CreateIndex
CREATE INDEX "access_token_client_id_idx" ON "access_token"("client_id");

-- CreateIndex
CREATE INDEX "attachments_table_table_id_record_id_idx" ON "attachments_table"("table_id", "record_id");

-- CreateIndex
CREATE INDEX "attachments_table_table_id_field_id_idx" ON "attachments_table"("table_id", "field_id");

-- CreateIndex
CREATE INDEX "attachments_table_attachment_id_idx" ON "attachments_table"("attachment_id");

-- CreateIndex
CREATE INDEX "collaborator_resource_id_idx" ON "collaborator"("resource_id");

-- CreateIndex
CREATE INDEX "collaborator_principal_id_idx" ON "collaborator"("principal_id");

-- CreateIndex
CREATE INDEX "dashboard_base_id_idx" ON "dashboard"("base_id");

-- CreateIndex
CREATE INDEX "integration_resource_id_idx" ON "integration"("resource_id");

-- CreateIndex
CREATE INDEX "invitation_base_id_idx" ON "invitation"("base_id");

-- CreateIndex
CREATE INDEX "invitation_space_id_idx" ON "invitation"("space_id");

-- CreateIndex
CREATE INDEX "invitation_record_invitation_id_idx" ON "invitation_record"("invitation_id");

-- CreateIndex
CREATE INDEX "invitation_record_base_id_idx" ON "invitation_record"("base_id");

-- CreateIndex
CREATE INDEX "invitation_record_space_id_idx" ON "invitation_record"("space_id");

-- CreateIndex
CREATE INDEX "plugin_install_position_id_idx" ON "plugin_install"("position_id");

-- CreateIndex
CREATE INDEX "plugin_install_base_id_idx" ON "plugin_install"("base_id");
