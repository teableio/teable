/*
  Warnings:

  - You are about to drop the column `url` on the `attachments` table. All the data in the column will be lost.
  - Added the required column `bucket` to the `attachments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "attachments" DROP COLUMN "url",
ADD COLUMN     "bucket" TEXT NOT NULL DEFAULT '';

-- UpdateData (path)
UPDATE "attachments"
SET "path" = REPLACE("path", '.assets/uploads/', 'table/')
WHERE "path" LIKE '%.assets/uploads/%';

-- Update table attachments
DO $$ 
DECLARE
    table_record RECORD;
    table_name TEXT;
    field_name TEXT;
		base_id TEXT;
BEGIN
    FOR table_record IN (
        SELECT
            tm.db_table_name,
            tm.base_id,
            (string_to_array(tm.db_table_name, '.'))[2] AS table_name,
            f.db_field_name,
						tm.name as t_name,
						f.name as f_name
        FROM
            field f
            JOIN table_meta tm ON f.table_id = tm.id
        WHERE
            f.type = 'attachment'
            AND f.deleted_time IS NULL
            AND tm.deleted_time IS NULL
    )
    LOOP
				base_id := table_record.base_id;
        table_name := table_record.table_name;
        field_name := table_record.db_field_name;
        -- Create a temporary table to store the transformed array of objects
				EXECUTE FORMAT('
						CREATE TEMPORARY TABLE t_table AS
						SELECT
								jsonb_array_elements(%I::jsonb) AS obj,
								__id as id
						FROM
								%I.%I
				', field_name, base_id, table_name);

				-- Query the necessary fields from the temporary table, and join with the attachments table to get the path field
				EXECUTE FORMAT('
						CREATE TEMPORARY TABLE t_table2 AS
						SELECT
								obj ->> ''id'' AS id,
								obj ->> ''name'' AS name,
								obj ->> ''token'' AS token,
								CAST(obj ->> ''size'' AS numeric) AS size,
								obj ->> ''mimetype'' AS mimetype,
								CAST(obj ->> ''width'' AS numeric) AS width,
								CAST(obj ->> ''height'' AS numeric) AS height,
								a.path AS path,
								t.id AS record_id
						FROM
								t_table t
								JOIN attachments a ON t.obj ->> ''token'' = a.token
				');

				-- Convert the data in the temporary table to jsonb type and update the column in the original table
				EXECUTE FORMAT('
						UPDATE
								%I.%I
						SET
								%I = (
										SELECT
												jsonb_agg(jsonb_strip_nulls(to_jsonb(t) - ''record_id''))
										FROM
												t_table2 t
										WHERE
												%I.%I.__id = t.record_id
								)
				', base_id, table_name, field_name, base_id, table_name);
				-- Drop template table
				EXECUTE FORMAT('DROP TABLE t_table; DROP TABLE t_table2');
    END LOOP;
END $$;
