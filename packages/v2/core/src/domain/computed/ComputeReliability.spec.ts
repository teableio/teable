import { describe, expect, it } from 'vitest';
import { BaseId } from '../base/BaseId';
import { FieldId } from '../table/fields/FieldId';
import { TableId } from '../table/TableId';
import {
  emptyComputeReliability,
  publicComputeError,
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
  it('summarizes only supplied authorized fields and strips private failure information', () => {
    expect(summarizeComputeReliability([issue, undefined])).toEqual(issue);
    expect(
      publicComputeError({ code: 'postgres', message: 'SELECT secret FROM customers' })
    ).toEqual({
      code: 'computed.update_failed',
      message: 'Computed results have not been updated',
    });
  });
});
