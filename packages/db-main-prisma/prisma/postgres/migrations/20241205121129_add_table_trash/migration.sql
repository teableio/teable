-- CreateTable
CREATE TABLE "table_trash" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "table_trash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_trash" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "record_trash_pkey" PRIMARY KEY ("id")
);
