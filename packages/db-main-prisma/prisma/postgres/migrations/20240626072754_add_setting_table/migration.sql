-- CreateTable
CREATE TABLE "setting" (
    "instance_id" TEXT NOT NULL,
    "disallow_sign_up" BOOLEAN,
    "disallow_space_creation" BOOLEAN,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("instance_id")
);

-- Insert initial record using UUID v4 format
INSERT INTO "setting" ("instance_id", "disallow_sign_up", "disallow_space_creation") 
VALUES (LOWER(
    SUBSTR(md5(random()::text), 1, 8) || '-' ||
    SUBSTR(md5(random()::text), 9, 4) || '-' ||
    '4' || SUBSTR(md5(random()::text), 13, 3) || '-' ||
    SUBSTR('89ab', 1 + (random() * 3)::integer, 1) ||
    SUBSTR(md5(random()::text), 17, 3) || '-' ||
    SUBSTR(md5(random()::text), 21, 12)
), NULL, NULL);
