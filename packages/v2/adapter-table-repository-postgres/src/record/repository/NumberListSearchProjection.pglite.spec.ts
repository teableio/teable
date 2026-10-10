import { PGlite } from '@electric-sql/pglite';
import {
  renderGeneratedSearchTextProjectionSql,
  roundedNumberListSearchFunctionSql,
  sanitizeSearchTextProjection,
  searchTextProjectionKey,
} from '@teable/v2-adapter-table-query-ops-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('rounded number list search document', () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(roundedNumberListSearchFunctionSql);
    const projection = renderGeneratedSearchTextProjectionSql('amounts', {
      kind: 'rounded_number_list',
      precision: 2,
    });
    await db.exec(`CREATE TABLE number_list_search (
      id integer PRIMARY KEY, amounts jsonb,
      document text GENERATED ALWAYS AS (${projection}) STORED
    )`);
    const cells = [
      '[1.234, -2.345, 0, 1000.999]',
      '[null, 3.1, null, "4.565"]',
      '[]',
      'null',
      null,
      '5.555',
      '"6.1"',
      '[1.005, 1.004, -1.005]',
    ];
    for (const [id, cell] of cells.entries()) {
      await db.query('INSERT INTO number_list_search(id, amounts) VALUES ($1, $2::jsonb)', [
        id,
        cell,
      ]);
    }
  });

  afterAll(() => db.close());

  it('stores exactly the legacy per-element rounding, order, separators and null semantics', async () => {
    const { rows } = await db.query(`SELECT id, document,
      (SELECT string_agg(round(elem.value::numeric, 2)::text, ', ')
       FROM jsonb_array_elements_text(CASE
         WHEN jsonb_typeof(amounts) = 'array' THEN amounts
         WHEN amounts IS NULL THEN '[]'::jsonb
         ELSE to_jsonb(ARRAY[amounts]) END) AS elem(value)) AS legacy
      FROM number_list_search ORDER BY id`);
    expect(rows.map((row) => row.document)).toEqual([
      '1.23, -2.35, 0.00, 1001.00',
      '3.10, 4.57',
      null,
      null,
      null,
      '5.56',
      '6.10',
      '1.01, 1.00, -1.01',
    ]);
    for (const row of rows) expect(row.document).toBe(row.legacy);
  });

  it.each(['1.23', '-2.35', '3.10, 4.57', '1.01, 1.00', '5.56', '6.10', '%', '_'])(
    'preserves exact matching record IDs for %s',
    async (probe) => {
      const pattern = `%${probe.replace(/[\\%_]/g, '\\$&')}%`;
      const legacy = await db.query(
        `SELECT id FROM number_list_search WHERE EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(round(elem.value::numeric, 2)::text, ', ') AS aggregated
          FROM jsonb_array_elements_text(CASE
            WHEN jsonb_typeof(amounts) = 'array' THEN amounts
            WHEN amounts IS NULL THEN '[]'::jsonb
            ELSE to_jsonb(ARRAY[amounts]) END) AS elem(value)
        ) AS sub WHERE sub.aggregated ILIKE $1 ESCAPE '\\'
      ) ORDER BY id`,
        [pattern]
      );
      const indexed = await db.query(
        "SELECT id FROM number_list_search WHERE document ILIKE $1 ESCAPE '\\' ORDER BY id",
        [pattern]
      );
      expect(indexed.rows).toEqual(legacy.rows);
    }
  );

  it('recomputes the stored projection on writes and includes precision in definition identity', async () => {
    await db.query('UPDATE number_list_search SET amounts = $1::jsonb WHERE id = 0', ['[42.555]']);
    const { rows } = await db.query('SELECT document FROM number_list_search WHERE id = 0');
    expect(rows).toEqual([{ document: '42.56' }]);
    expect(searchTextProjectionKey({ kind: 'rounded_number_list', precision: 2 })).toBe(
      'rounded_number_list(2)'
    );
    expect(
      sanitizeSearchTextProjection({ kind: 'rounded_number_list', precision: '2); DROP TABLE x' })
    ).toEqual({ kind: 'rounded_number_list', precision: 0 });
  });
});
