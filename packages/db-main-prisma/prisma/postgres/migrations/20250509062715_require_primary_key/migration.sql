BEGIN;

ALTER TABLE "comment_subscription" ADD COLUMN "id" TEXT DEFAULT substring(md5(random()::text), 1, 25),
ADD CONSTRAINT "comment_subscription_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "ops" ADD COLUMN "id" TEXT DEFAULT substring(md5(random()::text), 1, 25),
ADD CONSTRAINT "ops_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "plugin_context_menu" ADD COLUMN "id" TEXT DEFAULT substring(md5(random()::text), 1, 25),
ADD CONSTRAINT "plugin_context_menu_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "snapshots";

COMMIT;
