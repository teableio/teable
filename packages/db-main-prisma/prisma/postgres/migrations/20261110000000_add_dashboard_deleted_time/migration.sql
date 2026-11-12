-- A dashboard moved to the trash keeps its row until it is restored or purged.
ALTER TABLE "dashboard" ADD COLUMN "deleted_time" TIMESTAMP(3);
