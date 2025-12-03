import { CellValueType } from '@teable/core';
import { Plus } from '@teable/icons';
import { FieldRollup } from '@teable/openapi';
import type { ITableQuery } from '@teable/openapi';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { useFields, useStorage } from '../../../../hooks';

export const AddFieldButton = () => {
  const { fields } = useFields();
  const { storage, updateStorageByPath } = useStorage();
  const { query } = storage || {};
  const { seriesArray } = (query || {}) as ITableQuery;
  const fieldOptions = fields
    .filter(({ cellValueType }) => cellValueType === CellValueType.Number)
    ?.filter(
      (field) =>
        Array.isArray(seriesArray) && !seriesArray?.some((item) => item.fieldId === field.id)
    );
  return (
    fieldOptions.length > 0 && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Plus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[312px]" align="start">
          {fieldOptions?.map((field) => (
            <DropdownMenuItem
              key={field.id}
              onClick={() => {
                const paths: Array<{ path: string; value: unknown }> = [
                  {
                    path: 'query.seriesArray',
                    value: [
                      ...seriesArray,
                      {
                        fieldId: field.id,
                        rollup: FieldRollup.Sum,
                      },
                    ],
                  },
                ];
                const newSeriesArray = [
                  ...seriesArray,
                  {
                    fieldId: field.id,
                    rollup: FieldRollup.Sum,
                  },
                ];

                if (newSeriesArray.length >= 2) {
                  paths.push({ path: 'query.groupBy', value: null });
                }

                updateStorageByPath(paths);
              }}
            >
              {field.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  );
};
