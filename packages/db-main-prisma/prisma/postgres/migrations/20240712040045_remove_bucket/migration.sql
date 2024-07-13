/*
  Warnings:

  - You are about to drop the column `bucket` on the `attachments` table. All the data in the column will be lost.

*/
BEGIN;
-- AlterTable
ALTER TABLE "attachments" DROP COLUMN "bucket";
/** remove bucket in avatar and form cover url and logo url */
-- in avatar
UPDATE users
SET avatar = SUBSTRING(avatar FROM POSITION('/avatar/' IN avatar));
-- in form cover url
UPDATE view
SET options = jsonb_set(
  options::jsonb,
  '{logoUrl}',
  ('"' || REGEXP_REPLACE(options::jsonb->>'logoUrl', '^.+(/form/.*)$', '\1') || '"')::jsonb
)
WHERE type = 'Form' AND (options::jsonb ? 'logoUrl');

-- in logo url
UPDATE view
SET options = jsonb_set(
  options::jsonb,
  '{coverUrl}',
  ('"' || REGEXP_REPLACE(options::jsonb->>'coverUrl', '^.+(/form/.*)$', '\1') || '"')::jsonb
)
WHERE type = 'Form' AND (options::jsonb ? 'coverUrl');

-- update Form -> form
UPDATE view
SET type = 'form'
WHERE type = 'Form';
COMMIT;
