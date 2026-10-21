import { describe, expect, it } from 'vitest';
import { BaseId } from '../base/BaseId';
import { FieldId } from '../table/fields/FieldId';
import { TableId } from '../table/TableId';
import {
  computeReliabilitySchema,
  emptyComputeReliability,
  publicComputeError,
  sameComputeReliability,
  summarizeComputeReliability,
  summarizeFieldComputeReliability,
} from './ComputeReliability';
import { FieldComputeMeta } from './FieldComputeMeta';

const now = new Date('2026-09-05T00:00:00Z');
const create = () =>
  FieldComputeMeta.idle({
    baseId: BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap(),
    tableId: TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap(),
    fieldId: FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap(),
    now,
  });
const issue = {
  ...emptyComputeReliability(),
  unresolvedCount: 1,
  oldestUnresolvedAt: now.toISOString(),
};

describe('compute reliability projection', () => {
  it('keeps unresolved issues independent of execution and round trips persisted extensions', () => {
    const field = create();
    field.syncReliability(issue, now);
    expect(field.toDto().status).toBe('failed');
    const restored = FieldComputeMeta.fromDto(field.toDto())._unsafeUnwrap();
    restored.syncFromTaskRefs({ activeTaskCount: 1, processingTaskCount: 1, now });
    restored.syncReliability(issue, now);
    expect(restored.toDto()).toMatchObject({ status: 'running', reliability: issue });
    restored.noteTaskFinished({ error: null, now });
    restored.syncFromTaskRefs({ activeTaskCount: 0, processingTaskCount: 0, now });
    restored.syncReliability(issue, now);
    expect(restored.toDto()).toMatchObject({ status: 'failed', reliability: issue });
  });
  it('clears only explicitly resolved durable issues without another realtime generation bump', () => {
    const field = create();
    field.syncReliability(issue, now);
    const restored = FieldComputeMeta.fromDto(field.toDto())._unsafeUnwrap();
    restored.syncReliability(emptyComputeReliability(), now);
    expect(restored.toDto()).toMatchObject({ status: 'idle', lastError: null, generation: 2 });
    restored.syncReliability(emptyComputeReliability(), now);
    expect(restored.toDto().generation).toBe(2);
  });
  it('does not clear a pre-existing legacy failure when empty durable summaries are first introduced', () => {
    const field = create();
    field.notePersistentFailure({ error: { message: 'legacy failure' }, now });
    field.syncFromTaskRefs({ activeTaskCount: 0, processingTaskCount: 0, now });
    field.syncReliability(emptyComputeReliability(), now);
    const restored = FieldComputeMeta.fromDto(field.toDto())._unsafeUnwrap();
    restored.syncReliability(emptyComputeReliability(), now);
    expect(restored.toDto().status).toBe('failed');
  });
  it('counts a cross-field issue once and excludes unauthorized issue identities', () => {
    const field = {
      reliability: issue,
      extensions: {
        reliabilityIssueIdentities: {
          unresolved: ['shared'],
        },
      },
    };
    expect(summarizeFieldComputeReliability([field, field]).unresolvedCount).toBe(1);
    const privateField = {
      reliability: issue,
      extensions: {
        reliabilityIssueIdentities: {
          unresolved: ['private'],
        },
      },
    };
    expect(summarizeFieldComputeReliability([field, privateField]).unresolvedCount).toBe(2);
    expect(summarizeFieldComputeReliability([field]).unresolvedCount).toBe(1);
  });
  it('preserves only safe numeric context for the supported public size limit error', () => {
    expect(
      publicComputeError({
        code: 'validation.limit.computed_cell_value_max_bytes',
        message: 'secret SQL',
        context: { attempted: 20, max: 10, sql: 'secret' },
      })
    ).toEqual({
      code: 'validation.limit.computed_cell_value_max_bytes',
      message: 'Computed cell value exceeds the size limit',
      context: { attempted: 20, max: 10 },
    });
  });
  it('allows formula budget diagnostics with bounded scalar context only', () => {
    expect(
      publicComputeError({
        code: 'validation.limit.formula_compile_nodes_max',
        message: 'SELECT private_formula',
        context: {
          metric: 'uniqueNodes',
          attempted: 12,
          max: 10,
          policyVersion: 1,
          formula: 'secret',
          sql: 'SELECT secret',
        },
      })
    ).toEqual({
      code: 'validation.limit.formula_compile_nodes_max',
      message: 'Formula compilation exceeds the computation limit',
      context: { metric: 'uniqueNodes', attempted: 12, max: 10, policyVersion: 1 },
    });
    expect(
      publicComputeError({
        code: 'computed.stage_depth_exhausted',
        message: 'remaining plan contains customer data',
        context: { remaining: 4, sql: 'secret' },
      })
    ).toEqual({
      code: 'computed.stage_depth_exhausted',
      message: 'Computation did not finish; some results were not updated',
    });
  });
  it('drops malformed budget scalars instead of exposing them', () => {
    expect(
      publicComputeError({
        code: 'computed.resource_limit',
        message: 'private error',
        context: { attempted: -1, max: Infinity, policyVersion: 0, cause: 'secret' },
      })
    ).toEqual({
      code: 'computed.resource_limit',
      message: 'Computed results have not been updated due to a resource limit',
    });
  });
  it('keeps a safety failure through sibling completion, reload and reliability reconciliation', () => {
    const field = create();
    field.syncFromTaskRefs({ activeTaskCount: 1, processingTaskCount: 1, now });
    field.notePersistentFailure({
      error: {
        code: 'validation.limit.formula_compile_nodes_max',
        message: 'SELECT private_formula',
        context: { metric: 'uniqueNodes', attempted: 12, max: 10, sql: 'private_formula' },
      },
      now,
    });
    field.noteTaskFinished({ error: null, now });
    field.syncFromTaskRefs({ activeTaskCount: 0, processingTaskCount: 0, now });
    expect(field.toPublicDto()).toMatchObject({
      status: 'failed',
      lastError: {
        code: 'validation.limit.formula_compile_nodes_max',
      },
    });
    const restored = FieldComputeMeta.fromDto(field.toDto())._unsafeUnwrap();
    restored.syncReliability(issue, now);
    expect(restored.toPublicDto()).toMatchObject({
      status: 'failed',
      lastError: {
        code: 'validation.limit.formula_compile_nodes_max',
        context: { metric: 'uniqueNodes', attempted: 12, max: 10 },
      },
    });
    expect(JSON.stringify(restored.toPublicDto())).not.toContain('private_formula');
  });
  it('does not accept inherited property names or object-valued metrics as safe diagnostics', () => {
    expect(publicComputeError({ code: 'constructor', message: 'private' })?.code).toBe(
      'computed.update_failed'
    );
    expect(
      publicComputeError({
        code: 'validation.limit.formula_compile_nodes_max',
        message: 'private',
        context: { metric: { toString: () => 'uniqueNodes', private: 'secret' } },
      })?.context
    ).toBeUndefined();
  });
  it('summarizes only supplied authorized fields and strips private failure information', () => {
    expect(summarizeComputeReliability([issue, undefined])).toEqual(issue);
    expect(
      publicComputeError({ code: 'postgres', message: 'SELECT secret FROM customers' })
    ).toEqual({
      code: 'computed.update_failed',
      message: 'Computed results have not been updated',
    });
  });
  it('treats empty reliability as equal regardless of key order or missing projection', () => {
    const stored = computeReliabilitySchema.parse({
      scopeComplete: true,
      unresolvedCount: 0,
      oldestUnresolvedAt: null,
    });
    expect(sameComputeReliability(stored, emptyComputeReliability())).toBe(true);
    expect(sameComputeReliability(undefined, emptyComputeReliability())).toBe(true);
    expect(sameComputeReliability(undefined, undefined)).toBe(true);
    expect(sameComputeReliability(issue, emptyComputeReliability())).toBe(false);
  });
});
