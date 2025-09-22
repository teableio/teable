-- AlterTable
ALTER TABLE "comment_subscription" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ops" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "plugin_context_menu" ALTER COLUMN "id" DROP DEFAULT;

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
