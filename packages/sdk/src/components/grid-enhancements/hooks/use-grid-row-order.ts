import { FieldKeyType } from '@teable/core';
import { useCallback, useMemo, useState } from 'react';
import { useTableId, useView, useViewId } from '../../../hooks';
import { Record, type GridView } from '../../../model';
import type { IRecordIndexMap } from './use-grid-async-records';

export const useGridRowOrder = (recordMap: IRecordIndexMap) => {
  const tableId = useTableId();
  const viewId = useViewId();
  const view = useView(viewId) as GridView | undefined;
  const group = view?.group;

  const [draggingRecordIds, setDraggingRecordIds] = useState<string[]>();

  const onRowOrdered = useCallback(
    (rowIndexCollection: number[], newRowIndex: number) => {
      if (draggingRecordIds?.length !== rowIndexCollection.length) {
        return;
      }

      if (!viewId) {
        throw new Error('Can not find view id');
      }

      let fieldValueMap = {};

      if (group?.length) {
        const groupAnchorRecord = newRowIndex === 0 ? recordMap[1] : recordMap[newRowIndex - 1];

        if (!groupAnchorRecord) {
          throw new Error("Can't find the group anchor record by index: " + newRowIndex);
        }

        fieldValueMap =
          group.reduce(
            (prev, { fieldId }) => {
              prev[fieldId] = groupAnchorRecord.getCellValue(fieldId);
              return prev;
            },
            {} as { [key: string]: unknown }
          ) ?? {};
      }

      if (newRowIndex === 0) {
        return Record.updateRecords(tableId as string, {
          fieldKeyType: FieldKeyType.Id,
          records: draggingRecordIds.map((recordId) => ({ id: recordId, fields: fieldValueMap })),
          order: {
            viewId,
            anchorId: recordMap[0].id,
            position: 'before',
          },
        });
      }
      const record = recordMap[newRowIndex - 1];

      if (!record) {
        throw new Error("Can't find target record by index: " + newRowIndex);
      }

      return Record.updateRecords(tableId as string, {
        fieldKeyType: FieldKeyType.Id,
        records: draggingRecordIds.map((recordId) => ({ id: recordId, fields: fieldValueMap })),
        order: {
          viewId,
          anchorId: record.id,
          position: 'after',
        },
      });
    },
    [viewId, group, recordMap, tableId, draggingRecordIds]
  );

  return useMemo(() => {
    return {
      onRowOrdered,
      setDraggingRecordIds,
    };
  }, [onRowOrdered, setDraggingRecordIds]);
};
