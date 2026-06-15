DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'SpaceDataDbMigrationJobState'
      AND e.enumlabel = 'waiting_worker'
  ) THEN
    ALTER TYPE "SpaceDataDbMigrationJobState" ADD VALUE 'waiting_worker' AFTER 'pending';
  END IF;
END $$;
