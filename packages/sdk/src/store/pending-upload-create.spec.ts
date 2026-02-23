/* eslint-disable @typescript-eslint/naming-convention */
import type { IAttachmentItem } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import {
  finalizePendingUploadAfterCreate,
  mergePendingAttachmentsForCreate,
} from './pending-upload-create';
import type { IConsumedPendingForCreate } from './use-attachment-upload-store';

const createAttachment = (id: string, name: string): IAttachmentItem => ({
  id,
  name,
  path: `/attachments/${id}`,
  token: `token_${id}`,
  size: 1024,
  mimetype: 'text/plain',
});

describe('pending-upload-create helpers', () => {
  it('returns cloned fields and empty consumed map when tableId is missing', () => {
    const fields = { fld_text: 'hello' };
    const consumePendingForCreate =
      vi.fn<(tableId: string, tempRecordId: string) => IConsumedPendingForCreate>();

    const result = mergePendingAttachmentsForCreate({
      fields,
      tableId: undefined,
      tempRecordId: 'rec_temp',
      consumePendingForCreate,
    });

    expect(result.mergedFields).toEqual(fields);
    expect(result.mergedFields).not.toBe(fields);
    expect(result.consumedTaskIdsByCellKey).toEqual({});
    expect(consumePendingForCreate).not.toHaveBeenCalled();
  });

  it('merges completed pending attachments and deduplicates by attachment id', () => {
    const existing = createAttachment('att_existing', 'existing.txt');
    const duplicateExisting = createAttachment('att_existing', 'existing.txt');
    const newAttachment = createAttachment('att_new', 'new.txt');
    const consumedTaskIdsByCellKey = {
      'tbl:temp:fld_attachment': new Set(['task_1', 'task_2']),
    };

    const consumePendingForCreate = vi.fn<
      (tableId: string, tempRecordId: string) => IConsumedPendingForCreate
    >(() => ({
      completedByField: {
        fld_attachment: [duplicateExisting, newAttachment],
      },
      consumedTaskIdsByCellKey,
    }));

    const result = mergePendingAttachmentsForCreate({
      fields: {
        fld_attachment: [existing],
        fld_other: 123,
      },
      tableId: 'tbl',
      tempRecordId: 'temp',
      consumePendingForCreate,
    });

    expect(consumePendingForCreate).toHaveBeenCalledWith('tbl', 'temp');
    expect(result.mergedFields.fld_attachment).toEqual([existing, newAttachment]);
    expect(result.mergedFields.fld_other).toBe(123);
    expect(result.consumedTaskIdsByCellKey).toBe(consumedTaskIdsByCellKey);
  });

  it('does not call promote when tableId or realRecordId is missing', () => {
    const promoteToCell = vi.fn();
    const consumedTaskIdsByCellKey = { key: new Set(['task_1']) };

    finalizePendingUploadAfterCreate({
      tableId: undefined,
      tempRecordId: 'rec_temp',
      realRecordId: 'rec_real',
      consumedTaskIdsByCellKey,
      promoteToCell,
    });
    finalizePendingUploadAfterCreate({
      tableId: 'tbl',
      tempRecordId: 'rec_temp',
      realRecordId: undefined,
      consumedTaskIdsByCellKey,
      promoteToCell,
    });

    expect(promoteToCell).not.toHaveBeenCalled();
  });

  it('calls promote with consumed task map when create succeeds', () => {
    const promoteToCell = vi.fn();
    const consumedTaskIdsByCellKey = { key: new Set(['task_1']) };

    finalizePendingUploadAfterCreate({
      tableId: 'tbl',
      tempRecordId: 'rec_temp',
      realRecordId: 'rec_real',
      consumedTaskIdsByCellKey,
      promoteToCell,
    });

    expect(promoteToCell).toHaveBeenCalledWith(
      'tbl',
      'rec_temp',
      'rec_real',
      consumedTaskIdsByCellKey
    );
  });
});
