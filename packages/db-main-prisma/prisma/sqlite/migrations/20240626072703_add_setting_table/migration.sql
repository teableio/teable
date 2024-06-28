-- CreateTable
CREATE TABLE "setting" (
    "instance_id" TEXT NOT NULL,
    "disallow_sign_up" BOOLEAN,
    "disallow_space_creation" BOOLEAN,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("instance_id")
);

-- Insert initial record
INSERT INTO "setting" ("instance_id", "disallow_sign_up", "disallow_space_creation") VALUES ("instance-id", NULL, NULL);
