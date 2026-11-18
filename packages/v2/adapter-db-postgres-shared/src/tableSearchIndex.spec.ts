import { describe, expect, it } from 'vitest';

import { decodeTableSearchIndex } from './tableSearchIndex';

const legacy = {
  version: 1,
  dbTableName: 'base.records',
  definitionKey: 'reviewed',
  searchScope: 'selected_fields',
  generatedColumnName: '__tqops_search_old',
  indexName: 'idx_tqops_search_old',
  provider: 'pg_trgm',
  indexUsable: false,
  fields: [{ fieldId: 'fldOld', fieldDbName: 'old', textProjection: { kind: 'plain' } }],
};

describe('persisted search serving snapshots', () => {
  it('keeps the saved selected membership when decoding a degraded v1 generation', () => {
    expect(decodeTableSearchIndex(legacy)).toMatchObject({
      version: 2,
      fieldIds: ['fldOld'],
      searchScope: 'selected_fields',
      document: { ready: false, fields: legacy.fields },
    });
  });

  it('retains an empty selected fallback instead of enrolling current table fields', () => {
    expect(decodeTableSearchIndex({ ...legacy, fields: [] })).toMatchObject({
      version: 2,
      fieldIds: [],
      searchScope: 'selected_fields',
      document: { ready: false, fields: [] },
    });
  });

  it('loads a residual-only generation without fictitious document objects', () => {
    const snapshot = {
      version: 2,
      dbTableName: 'base.records',
      definitionKey: 'residual',
      searchScope: 'all_fields',
      fieldIds: ['fldGenerated'],
      residual: {
        provider: 'pg_bigm',
        indexName: 'idx_tqops_search_residual_one',
        ready: true,
        expression: 'lower(coalesce(("generated")::text, \'\'))',
        fields: [
          { fieldId: 'fldGenerated', fieldDbName: 'generated', textProjection: { kind: 'plain' } },
        ],
      },
    };
    expect(decodeTableSearchIndex(snapshot)).toEqual(snapshot);
    expect(decodeTableSearchIndex(snapshot)).not.toHaveProperty('document');
  });

  it.each(['document', 'residual'] as const)(
    'keeps logical intent and a valid %s when the other branch is malformed',
    (kind) => {
      const envelope = {
        version: 2,
        dbTableName: legacy.dbTableName,
        definitionKey: 'mixed',
        searchScope: 'selected_fields',
        fieldIds: ['fldOld'],
      };
      const branch = {
        provider: 'pg_trgm',
        indexName: 'idx_search',
        ready: true,
        fields: legacy.fields,
        ...(kind === 'document'
          ? { generatedColumnName: '__search' }
          : { expression: 'canonical' }),
      };
      const other = kind === 'document' ? 'residual' : 'document';
      expect(
        decodeTableSearchIndex({ ...envelope, [kind]: branch, [other]: { ready: 'true' } })
      ).toEqual({ ...envelope, [kind]: branch });
    }
  );

  it('keeps selected-empty intent even when both physical branches are malformed', () => {
    const envelope = {
      version: 2,
      dbTableName: legacy.dbTableName,
      definitionKey: 'empty',
      searchScope: 'selected_fields',
      fieldIds: [],
    };
    expect(
      decodeTableSearchIndex({ ...envelope, document: null, residual: { ready: 'true' } })
    ).toEqual(envelope);
    expect(decodeTableSearchIndex({ ...envelope, fieldIds: [null] })).toBeUndefined();
  });

  it.each([
    { ...legacy, version: 99 },
    { ...legacy, indexUsable: 'true' },
    {
      ...legacy,
      fields: [{ fieldId: 'fldOld', fieldDbName: 'old', textProjection: { kind: 'date_range' } }],
    },
  ])('rejects malformed persisted state without turning it into serving coverage', (raw) => {
    expect(decodeTableSearchIndex(raw)).toBeUndefined();
  });
});
