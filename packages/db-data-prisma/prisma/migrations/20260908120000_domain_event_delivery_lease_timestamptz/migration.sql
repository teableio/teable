DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'domain_event_delivery'
      AND column_name = 'lease_expires_at'
      AND udt_name = 'timestamp'
  ) THEN
    ALTER TABLE "domain_event_delivery"
      ALTER COLUMN "lease_expires_at" TYPE TIMESTAMP(3) WITH TIME ZONE
      USING "lease_expires_at" AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'domain_event_delivery'
      AND column_name = 'next_attempt_at'
      AND udt_name = 'timestamp'
  ) THEN
    ALTER TABLE "domain_event_delivery"
      ALTER COLUMN "next_attempt_at" TYPE TIMESTAMP(3) WITH TIME ZONE
      USING "next_attempt_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
