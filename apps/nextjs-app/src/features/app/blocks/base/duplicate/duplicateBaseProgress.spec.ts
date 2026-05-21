import type { IDuplicateBaseProgressEvent } from '@teable/openapi';
import { describe, expect, it } from 'vitest';

import { getDuplicateProgressPercent, mergeDuplicateProgress } from './duplicateBaseProgress';

const progressEvent = (
  event: Partial<IDuplicateBaseProgressEvent> & Pick<IDuplicateBaseProgressEvent, 'phase'>
): IDuplicateBaseProgressEvent => ({
  type: 'progress',
  ...event,
});

describe('duplicateBaseProgress', () => {
  it('keeps progress monotonic when row copying starts after table creation', () => {
    const structureDone = progressEvent({
      phase: 'table_structure_done',
      tableIndex: 60,
      totalTables: 60,
    });
    const rowCopyStarted = progressEvent({
      phase: 'table_data_progress',
      processedRows: 0,
      totalRows: 2730,
    });
    const rowCopyProgress = progressEvent({
      phase: 'table_data_progress',
      processedRows: 1365,
      totalRows: 2730,
    });

    expect(getDuplicateProgressPercent(structureDone)).toBe(30);
    expect(getDuplicateProgressPercent(rowCopyStarted)).toBe(30);
    expect(getDuplicateProgressPercent(rowCopyProgress)).toBeGreaterThan(
      getDuplicateProgressPercent(rowCopyStarted)
    );
  });

  it('keeps the previous numeric progress for non-numeric phase events', () => {
    const structureDone = progressEvent({
      phase: 'table_structure_done',
      tableIndex: 60,
      totalTables: 60,
    });
    const creatingFolders = mergeDuplicateProgress(
      structureDone,
      progressEvent({ phase: 'creating_folders' })
    );
    const restoringBaseNodes = mergeDuplicateProgress(
      creatingFolders,
      progressEvent({ phase: 'restoring_base_nodes' })
    );

    expect(getDuplicateProgressPercent(creatingFolders)).toBe(30);
    expect(getDuplicateProgressPercent(restoringBaseNodes)).toBe(30);
  });

  it('advances after table data copy instead of resetting during attachments', () => {
    const rowCopyDone = progressEvent({
      phase: 'table_data_done',
      processedRows: 2730,
      totalRows: 2730,
    });
    const attachmentsCopying = progressEvent({
      phase: 'attachments_copying',
      processedRows: 2730,
      totalRows: 2730,
    });

    expect(getDuplicateProgressPercent(rowCopyDone)).toBe(95);
    expect(getDuplicateProgressPercent(attachmentsCopying)).toBe(98);
  });
});
