-- A base created without a name no longer gets the English placeholder "Untitled Project"
-- written into the row. NULL means "nobody has named this base yet": clients render a
-- localized placeholder, and the AI may pick a name from the first conversation until a
-- person or the AI fills it in. Existing rows all carry a name and are left untouched.
ALTER TABLE "base" ALTER COLUMN "name" DROP NOT NULL;
