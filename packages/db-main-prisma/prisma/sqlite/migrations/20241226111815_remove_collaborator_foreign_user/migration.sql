-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_collaborator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role_name" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "principal_type" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_time" DATETIME,
    "last_modified_by" TEXT
);
INSERT INTO "new_collaborator" ("created_by", "created_time", "id", "last_modified_by", "last_modified_time", "principal_id", "principal_type", "resource_id", "resource_type", "role_name") SELECT "created_by", "created_time", "id", "last_modified_by", "last_modified_time", "principal_id", "principal_type", "resource_id", "resource_type", "role_name" FROM "collaborator";
DROP TABLE "collaborator";
ALTER TABLE "new_collaborator" RENAME TO "collaborator";
CREATE UNIQUE INDEX "collaborator_resource_type_resource_id_principal_id_principal_type_key" ON "collaborator"("resource_type", "resource_id", "principal_id", "principal_type");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
