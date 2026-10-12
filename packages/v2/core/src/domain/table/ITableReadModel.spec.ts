import { describe, expect, it } from 'vitest';

import type { ITableReadModel } from './ITableReadModel';

type MutatingTableKeys =
  | 'addField'
  | 'removeField'
  | 'replaceField'
  | 'updateField'
  | 'update'
  | 'clone'
  | 'duplicate'
  | 'createRecord'
  | 'updateRecord'
  | 'createRecords'
  | 'createView'
  | 'deleteView'
  | 'rename'
  | 'setDbTableName';

type LeakedMutateKeys = Extract<keyof ITableReadModel, MutatingTableKeys>;
type AssertNoMutate = [LeakedMutateKeys] extends [never] ? true : never;

describe('ITableReadModel', () => {
  it('does not expose Table mutating methods', () => {
    const assertNoMutate: AssertNoMutate = true;
    expect(assertNoMutate).toBe(true);
  });
});
