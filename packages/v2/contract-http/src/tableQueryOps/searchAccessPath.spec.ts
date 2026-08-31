import { describe, expect, it } from 'vitest';

import {
  getSearchAccessPathCapabilitiesOkResponseSchema,
  getSearchAccessPathStatusOkResponseSchema,
  reconcileSearchAccessPathInputSchema,
  reconcileSearchAccessPathOkResponseSchema,
} from './searchAccessPath';

describe('search access path HTTP contract', () => {
  it('exposes the native managed status model', () => {
    expect(
      getSearchAccessPathStatusOkResponseSchema.parse({
        ok: true,
        data: {
          status: {
            tableId: 'tbl-status',
            state: 'ready',
            configured: true,
            languageConfig: 'simple',
            semantics: 'substring',
            provider: 'pg_trgm',
            accessPath: 'generated_text',
            coveredFieldCount: 3,
          },
        },
      })
    ).toMatchObject({ ok: true, data: { status: { state: 'ready' } } });

    expect(
      getSearchAccessPathStatusOkResponseSchema.safeParse({
        ok: true,
        data: {
          status: {
            tableId: 'tbl-status',
            activated: true,
            configured: true,
            coveredFieldCount: 3,
          },
        },
      }).success
    ).toBe(false);
  });

  it.each(['disabled', 'rebuild_pending', 'stale', 'unknown'] as const)(
    'accepts native managed status %s',
    (state) => {
      expect(
        getSearchAccessPathStatusOkResponseSchema.parse({
          ok: true,
          data: {
            status: {
              tableId: 'tbl-status',
              state,
              configured: state !== 'disabled',
              coveredFieldCount: 0,
            },
          },
        }).data.status.state
      ).toBe(state);
    }
  );

  it('exposes provider capabilities without v1 abnormal/repair flags', () => {
    expect(
      getSearchAccessPathCapabilitiesOkResponseSchema.parse({
        ok: true,
        data: {
          capabilities: [
            {
              provider: 'pg_trgm',
              extensionName: 'pg_trgm',
              operatorClass: 'gin_trgm_ops',
              operatorClassInstalled: true,
              minimumProbeLength: 3,
              state: 'ready',
              installed: true,
              available: true,
              preloaded: true,
            },
          ],
        },
      }).data.capabilities
    ).toHaveLength(1);
  });

  it.each(['create', 'rebuild', 'drop'] as const)('accepts reconcile mode %s', (mode) => {
    expect(
      reconcileSearchAccessPathInputSchema.parse({
        tableId: 'tbl-reconcile',
        mode,
        expectedDefinitionKey: 'definition-key',
        semantics: 'substring',
        provider: 'pg_trgm',
        languageConfig: 'simple',
        fieldIds: ['fld-primary'],
        searchProbe: 'needle',
      })
    ).toMatchObject({ tableId: 'tbl-reconcile', mode });
  });

  it('does not expose adapter execution controls in the public input', () => {
    expect(
      reconcileSearchAccessPathInputSchema.safeParse({
        tableId: 'tbl-reconcile',
        mode: 'create',
        validationMode: 'real_ddl',
      }).success
    ).toBe(false);
    expect(
      reconcileSearchAccessPathInputSchema.safeParse({
        tableId: 'tbl-reconcile',
        mode: 'create',
        allowLargeTableRewrite: true,
      }).success
    ).toBe(false);
  });

  it.each([
    { expectedDefinitionKey: 'x'.repeat(513) },
    { languageConfig: 'x'.repeat(129) },
    { fieldIds: ['x'.repeat(129)] },
    { fieldIds: Array.from({ length: 501 }, (_, index) => `fld-${index}`) },
    { searchProbe: 'x'.repeat(2_001) },
  ])('bounds public reconcile text and list inputs %#', (extra) => {
    expect(
      reconcileSearchAccessPathInputSchema.safeParse({
        tableId: 'tbl-reconcile',
        mode: 'create',
        ...extra,
      }).success
    ).toBe(false);
  });

  it('maps the reconciler result without v1 index state aliases', () => {
    expect(
      reconcileSearchAccessPathOkResponseSchema.parse({
        ok: true,
        data: {
          result: {
            action: 'created',
            tableId: 'tbl-reconcile',
            definitionKey: 'definition-key',
            generatedColumnName: '__teable_search',
            indexName: 'idx_teable_search',
            languageConfig: 'simple',
            semantics: 'substring',
            provider: 'pg_trgm',
            fieldIds: ['fld-primary'],
            status: 'ready',
          },
        },
      }).data.result
    ).toMatchObject({ action: 'created', status: 'ready' });
  });
});
