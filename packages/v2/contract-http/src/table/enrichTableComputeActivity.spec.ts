import { describe, expect, it } from 'vitest';

import type { ITableDto } from './dto';
import { enrichTableDtoWithComputeActivity } from './enrichTableComputeActivity';

const baseTable = (): ITableDto =>
  ({
    id: 'tblTestTable123456',
    baseId: 'bseTestBase123456',
    name: 'Products',
    fields: [
      {
        id: 'fldFormula1',
        name: 'Formula',
        type: 'formula',
        isPrimary: false,
        isComputed: true,
      },
      {
        id: 'fldText1',
        name: 'Title',
        type: 'singleLineText',
        isPrimary: true,
      },
    ],
    views: [],
  }) as unknown as ITableDto;

describe('enrichTableDtoWithComputeActivity', () => {
  it('marks field and table as calculating from activity snapshot', () => {
    const table = enrichTableDtoWithComputeActivity(baseTable(), {
      tableId: 'tblTestTable123456',
      baseId: 'bseTestBase123456',
      table: {
        tableId: 'tblTestTable123456',
        baseId: 'bseTestBase123456',
        status: 'calculating',
        calculatingFieldCount: 1,
        queuedFieldCount: 0,
        estimatedComplexity: 12,
        recentCompletions: [],
        generation: 2,
        updatedAt: new Date().toISOString(),
        computeMode: 'server',
      },
      fields: [
        {
          fieldId: 'fldFormula1',
          tableId: 'tblTestTable123456',
          baseId: 'bseTestBase123456',
          status: 'running',
          activeTaskCount: 1,
          processingTaskCount: 1,
          generation: 2,
          estimatedComplexity: 12,
          estimatedDirtyRecords: 100,
          hasAllTargetRecords: false,
          updatedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
        },
      ],
      diagnostics: {
        computeMode: 'server',
        executionState: 'running',
        activeFieldCount: 1,
        queuedFieldCount: 0,
        calculatingFieldCount: 1,
        failedFieldCount: 0,
        highComplexityFieldCount: 0,
        anomalies: [],
        pause: {
          effective: false,
          blockers: [],
          queuedTaskCount: 0,
          oldestQueuedAt: null,
        },
      },
    });

    expect(table.computeMeta?.status).toBe('calculating');
    expect(table.computeMeta?.calculatingFieldCount).toBe(1);
    expect(table.fields.find((f) => f.id === 'fldFormula1')?.computeMeta?.status).toBe('running');
    expect(table.fields.find((f) => f.id === 'fldText1')?.computeMeta).toBeUndefined();
  });

  it('marks observation unavailable when activity is null', () => {
    const table = enrichTableDtoWithComputeActivity(baseTable(), null);
    expect(table.computeMeta?.status).toBe('idle');
    expect(table.computeMeta?.calculatingFieldCount).toBe(0);
    expect(table.computeMeta?.observationState).toBe('unavailable');
  });
  it('strips old field and aggregate metadata when observation fails', () => {
    const previous = baseTable();
    previous.fields[0].computeMeta = {
      status: 'failed',
      reliability: { unresolvedCount: 9, oldestUnresolvedAt: null, scopeComplete: true },
    };
    previous.computeMeta = {
      status: 'calculating',
      calculatingFieldCount: 9,
      recentCompletions: [
        { fieldId: 'private', durationMs: 5, completedAt: '2026-09-05T00:00:00.000Z' },
      ],
    };
    const result = enrichTableDtoWithComputeActivity(previous, null);
    expect(result.fields.every((field) => !field.computeMeta)).toBe(true);
    expect(result.computeMeta).toMatchObject({
      observationState: 'unavailable',
      calculatingFieldCount: 0,
    });
    expect(result.computeMeta?.recentCompletions).toBeUndefined();
  });
});
