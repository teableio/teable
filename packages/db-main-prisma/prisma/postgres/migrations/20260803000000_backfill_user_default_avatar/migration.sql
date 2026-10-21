-- Backfill default avatar paths for legacy users (created before 2024-03,
-- when default avatar generation was introduced). A NULL avatar fails V2
-- user field updates with a 400 validation error.
-- The written path matches UserService.generateDefaultAvatar; the avatar
-- image itself may not exist in storage, in which case the UI falls back
-- to the user's initial (same rendering as before this migration).
-- System robots are intentionally left untouched (is_system is only ever
-- NULL or TRUE).
UPDATE "users"
SET "avatar" = 'avatar/' || "id"
WHERE "avatar" IS NULL
  AND "is_system" IS NULL;
