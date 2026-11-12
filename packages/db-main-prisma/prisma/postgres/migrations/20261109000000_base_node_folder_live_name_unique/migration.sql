-- A folder in the trash holds no name: names are unique among the folders not in the trash only.
CREATE INDEX "base_node_folder_base_id_idx" ON "base_node_folder"("base_id");
DROP INDEX "base_node_folder_base_id_name_key";
CREATE UNIQUE INDEX "base_node_folder_base_id_name_live_key" ON "base_node_folder"("base_id", "name") WHERE "deleted_time" IS NULL;
