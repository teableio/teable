-- A folder moved to the trash keeps its row (and its name) until it is restored or purged.
ALTER TABLE "base_node_folder" ADD COLUMN "deleted_time" TIMESTAMP(3);
