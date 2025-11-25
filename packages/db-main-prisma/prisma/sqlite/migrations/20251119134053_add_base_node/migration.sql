-- CreateTable
CREATE TABLE "base_node" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parent_id" TEXT,
    "base_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "order" REAL NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" DATETIME,
    "last_modified_by" TEXT,
    CONSTRAINT "base_node_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "base_node" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "base_node_folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" DATETIME,
    "last_modified_by" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "base_node_base_id_resource_type_resource_id_key" ON "base_node"("base_id", "resource_type", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "base_node_folder_base_id_name_key" ON "base_node_folder"("base_id", "name");
