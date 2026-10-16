import { knex as createKnex } from 'knex';
import type { IFieldInstance } from '../../../field/model/factory';
import { QuerySelect } from './select';

// Regression guard for the base-query select SQL injection (T7688):
// QuerySelect rewrites a field's dbFieldName to the user-controlled alias (so nested
// queries can reference the column by alias). dbFieldName is interpolated raw because
// it is an already-quoted / qualified identifier. Selecting the same column twice used
// to turn the first row's alias into a raw-interpolated dbFieldName on the second row,
// i.e. attacker SQL. The fix emits every select from a pre-loop snapshot of the
// validated dbFieldName, so a duplicated column can never emit a prior alias raw.
describe('QuerySelect — select[].alias SQL injection guard (T7688)', () => {
  const knex = createKnex({ client: 'pg' });

  // The parser only reads id / name / dbFieldName / description here (no groupBy /
  // aggregation), so a plain object standing in for a Field-typed instance is enough.
  const makeField = (id: string, dbFieldName: string): IFieldInstance =>
    ({ id, name: id, dbFieldName }) as unknown as IFieldInstance;

  it('emits a duplicated column from its real name, never from a prior alias interpolated raw', () => {
    // Mirror the real pipeline where dbFieldName is an already-quoted, qualified column.
    const fieldMap = { fldX: makeField('fldX', '"t"."Name"') };
    const queryBuilder = knex.queryBuilder().from('t');
    const payload = 'pg_sleep(5)) --';

    new QuerySelect().parse(
      [
        { column: 'fldX', alias: payload },
        { column: 'fldX', alias: 'leak' },
      ] as never,
      {
        knex,
        queryBuilder,
        fieldMap,
        aggregation: undefined,
        groupBy: undefined,
        dbProvider: {} as never,
      }
    );

    const sql = queryBuilder.toQuery();

    // The second select of the duplicated column uses the real column, not the alias …
    expect(sql).toContain('"t"."Name" as "leak"');
    // … the payload only ever appears as a knex-quoted output alias …
    expect(sql).toContain('as "pg_sleep(5)) --"');
    // … and is never interpolated raw as a column expression (the pre-fix injection).
    expect(sql).not.toMatch(/pg_sleep\(5\)\) -- as/);
    // The qualified identifier is preserved (not double-quoted by a stray ?? bind).
    expect(sql).not.toContain('"""t"""');
  });
});
