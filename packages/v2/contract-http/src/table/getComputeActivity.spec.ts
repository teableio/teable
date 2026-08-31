import type { TableComputeActivitySnapshot } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { mapComputeActivitySnapshotToDto } from './getComputeActivity';

const snapshot: TableComputeActivitySnapshot = {
  tableId: 'tblTestTable123456',
  baseId: 'bseTestBase1234567',
  table: {
    tableId: 'tblTestTable123456',
    baseId: 'bseTestBase1234567',
    status: 'calculating',
    calculatingFieldCount: 1,
    queuedFieldCount: 0,
    estimatedComplexity: 10,
    recentCompletions: [],
    generation: 4,
    updatedAt: '2026-07-17T00:00:00.000Z',
    computeMode: 'server',
  },
  fields: [
    {
      fieldId: 'fldFormula1234567',
      tableId: 'tblTestTable123456',
      baseId: 'bseTestBase1234567',
      status: 'running',
      activeTaskCount: 3,
      processingTaskCount: 1,
      generation: 4,
      estimatedComplexity: 10,
      estimatedDirtyRecords: 900,
      hasAllTargetRecords: false,
      updatedAt: '2026-07-17T00:00:00.000Z',
      extensions: {
        batchProgress: { total: 5, completed: 2 },
      },
    },
  ],
  diagnostics: {
    computeMode: 'server',
    executionState: 'paused',
    activeFieldCount: 1,
    queuedFieldCount: 0,
    calculatingFieldCount: 1,
    failedFieldCount: 0,
    highComplexityFieldCount: 0,
    anomalies: [],
    pause: {
      effective: true,
      blockers: [
        {
          id: 'cupPause123456789',
          scopeType: 'base',
          scopeId: 'bseTestBase1234567',
          pausedAt: '2026-07-19T16:26:52.088Z',
          pausedBy: 'ops',
          resumeAt: '2026-08-02T12:00:00.000Z',
          reason: 'maintenance',
        },
      ],
      queuedTaskCount: 96,
      oldestQueuedAt: '2026-07-19T16:26:52.088Z',
    },
  },
};

describe('mapComputeActivitySnapshotToDto', () => {
  it('exposes current batch progress with task state counts', () => {
    const result = mapComputeActivitySnapshotToDto(snapshot)._unsafeUnwrap();

    expect(result.fields[0]).toMatchObject({
      fieldId: 'fldFormula1234567',
      activeTaskCount: 3,
      processingTaskCount: 1,
      batchProgress: { total: 5, completed: 2 },
    });
    expect(result.table).toMatchObject({
      generation: 4,
      updatedAt: '2026-07-17T00:00:00.000Z',
    });
    expect(result.diagnostics).toMatchObject({
      executionState: 'paused',
      pause: {
        effective: true,
        queuedTaskCount: 96,
        oldestQueuedAt: '2026-07-19T16:26:52.088Z',
        blockers: [
          {
            id: 'cupPause123456789',
            scopeType: 'base',
            scopeId: 'bseTestBase1234567',
            pausedAt: '2026-07-19T16:26:52.088Z',
            pausedBy: 'ops',
            resumeAt: '2026-08-02T12:00:00.000Z',
            reason: 'maintenance',
          },
        ],
      },
    });
  });
});
