ALTER TYPE "SpaceDataDbMigrationJobState" ADD VALUE IF NOT EXISTS 'waiting_worker' AFTER 'pending';
