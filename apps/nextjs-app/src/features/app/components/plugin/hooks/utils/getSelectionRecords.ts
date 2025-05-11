import { FieldKeyType } from '@teable/core';
import type { IRecordsVo } from '@teable/openapi';
import { getRecords } from '@teable/openapi';
import { SelectionRegionType } from '@teable/sdk/components';
import type { IGetSelectionRecordsVo, ISelection } from '@teable/sdk/plugin-bridge';
import { useSelectionStore } from '@/features/app/blocks/view/grid/hooks/useSelectionStore';

export const getSelectionRecords = async (
  tableId: string,
  viewId: string,
  selection: ISelection,
  options?: {
    skip?: number;
    take?: number;
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity
): Promise<IGetSelectionRecordsVo> => {
  const { groupBy, search, fields, collapsedGroupIds, personalViewCommonQuery } =
    useSelectionStore.getState();
  if (!fields) {
    return {
      records: [],
      fields: [],
    };
  }

  const { type, range } = selection;
  const { skip = 0, take = 100 } = options || {};

  const getRecordsByQuery = ({
    skip,
    take,
    projection,
  }: {
    skip: number;
    take: number;
    projection: string[];
  }) => {
    return getRecords(tableId, {
      ...personalViewCommonQuery,
      viewId,
      groupBy,
      search,
      collapsedGroupIds,
      projection,
      skip,
      take,
      fieldKeyType: FieldKeyType.Id,
    }).then((res) => res.data.records);
  };
  switch (type) {
    case SelectionRegionType.Cells: {
      const [[startColIndex, startRowIndex], [endColIndex, endRowIndex]] = range;
      if (
        startColIndex == null ||
        startRowIndex == null ||
        endColIndex == null ||
        endRowIndex == null
      ) {
        throw new Error('Invalid selection range');
      }
      const projectionFields = fields.slice(startColIndex, endColIndex + 1);
      const projection = projectionFields.map((item) => item.id);
      const records = await getRecordsByQuery({
        projection,
        skip: skip + startRowIndex,
        take: Math.min(take, endRowIndex - startRowIndex + 1),
      });
      return {
        records,
        fields: projectionFields.map((item) => item['doc'].data),
      };
    }
    case SelectionRegionType.Rows: {
      const allRecords: IRecordsVo['records'] = [];
      let totalSkip = skip;
      let totalTake = take;
      const projection = fields.map((item) => item.id);
      for (let i = 0; i < range.length; i++) {
        const [startRowIndex, endRowIndex] = range[i];
        const currentRowCount = endRowIndex - startRowIndex + 1;
        if (totalSkip >= currentRowCount) {
          totalSkip -= currentRowCount;
          continue;
        }

        const records = await getRecordsByQuery({
          projection,
          skip: totalSkip + startRowIndex,
          take: Math.min(totalTake, currentRowCount),
        });
        allRecords.push(...records);
        if (totalTake > currentRowCount) {
          totalTake -= currentRowCount;
          totalSkip = 0;
        } else {
          break;
        }
      }
      return {
        records: allRecords,
        fields: fields.map((item) => item['doc'].data),
      };
    }
    case SelectionRegionType.Columns: {
      const projections: string[] = [];
      for (let i = 0; i < fields.length; i++) {
        const [startColIndex, endColIndex] = range[i];
        projections.push(...fields.slice(startColIndex, endColIndex).map((item) => item.id));
      }
      const records = await getRecordsByQuery({
        projection: projections,
        skip,
        take,
      });
      return {
        records,
        fields: fields.map((item) => item['doc'].data),
      };
    }
    default: {
      console.error(`Unsupported selection type: ${type}`);
      return {
        records: [],
        fields: [],
      };
    }
  }
};
