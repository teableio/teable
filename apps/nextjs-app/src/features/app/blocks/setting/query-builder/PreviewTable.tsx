import { nullsToUndefinedShallow } from '@teable/core';
import { ChevronLeft, ChevronRight } from '@teable/icons';
import { getRecords, type IGetRecordsRo, type IQueryBaseRo } from '@teable/openapi';
import type { ICell, ICellItem } from '@teable/sdk/components';
import {
  CellType,
  DraggableType,
  Grid,
  SelectableType,
  useGridAsyncRecords,
  useGridColumns,
  useGridIcons,
  useGridTheme,
} from '@teable/sdk/components';
import { useIsHydrated, useTableId } from '@teable/sdk/hooks';
import { Table } from '@teable/sdk/model/table';
import { ToggleGroup, ToggleGroupItem, Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { developerConfig } from '@/features/i18n/developer.config';
import { CodeBlock } from './PreviewScript';
import { useTransformFieldKey } from './useTransformFieldKey';

export const PreviewTable = ({ query: queryRaw }: { query: IGetRecordsRo }) => {
  const { t } = useTranslation(developerConfig.i18nNamespaces);
  const theme = useGridTheme();
  const { columns, cellValue2GridDisplay } = useGridColumns(false);
  const transformFieldKey = useTransformFieldKey();
  const query = useMemo(() => transformFieldKey(queryRaw), [transformFieldKey, queryRaw]);

  const [rowCount, setRowCount] = useState<number>(0);
  const [recordRes, setRecordRes] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const tableId = useTableId();
  const [mode, setMode] = useState<string>('json');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  useEffect(() => {
    if (tableId == null) return;

    // Extract only IQueryBaseRo fields from query
    const { projection, cellFormat, fieldKeyType, take, skip, ...queryBaseParams } = query;
    Table.getRowCount(tableId, nullsToUndefinedShallow(queryBaseParams) as IQueryBaseRo).then(
      (res) => {
        setRowCount(res.data.rowCount);
      }
    );
  }, [tableId, query]);

  const isHydrated = useIsHydrated();

  const customIcons = useGridIcons();

  const { recordMap, onVisibleRegionChanged } = useGridAsyncRecords(undefined, query);

  // Fetch JSON data when mode is json or when tableId/query/page/pageSize changes
  useEffect(() => {
    if (mode !== 'json' || !tableId) {
      return;
    }

    setIsLoading(true);
    const queryParams: IGetRecordsRo = {
      skip: (page - 1) * pageSize,
      take: pageSize,
    };

    // Only add non-null/undefined parameters
    if (query.filter) queryParams.filter = query.filter;
    if (query.orderBy) queryParams.orderBy = query.orderBy;
    if (query.viewId) queryParams.viewId = query.viewId;
    if (query.search) queryParams.search = query.search;
    if (query.cellFormat) queryParams.cellFormat = query.cellFormat;
    if (query.fieldKeyType) queryParams.fieldKeyType = query.fieldKeyType;

    getRecords(tableId, queryParams)
      .then((res) => {
        setRecordRes(res.data);
      })
      .catch((err) => {
        console.error('Failed to fetch records:', err);
        setRecordRes({ error: 'Failed to fetch records' });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [mode, query, tableId, page, pageSize]);

  const getCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell) => {
      const [colIndex, rowIndex] = cell;
      const record = recordMap[rowIndex];
      if (record !== undefined) {
        const fieldId = columns[colIndex]?.id;
        if (!fieldId) return { type: CellType.Loading };
        return cellValue2GridDisplay(record, colIndex);
      }
      return { type: CellType.Loading };
    },
    [recordMap, columns, cellValue2GridDisplay]
  );

  const totalPages = Math.ceil((rowCount || 0) / pageSize);

  const handlePageChange = (newPage: number) => {
    setPage(Math.max(1, Math.min(newPage, totalPages)));
  };

  return (
    <>
      <div className="flex">
        <ToggleGroup
          className="w-auto"
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          onValueChange={(v) => setMode(v || 'grid')}
        >
          <ToggleGroupItem value="grid" aria-label="Toggle view">
            Grid
          </ToggleGroupItem>
          <ToggleGroupItem value="json" aria-label="Toggle json">
            JSON
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {mode === 'grid' && isHydrated && (
        <>
          <p>{t('developer:showPagination')}</p>
          <div className="relative h-[500px] w-full overflow-hidden rounded-lg border">
            <Grid
              style={{
                width: '100%',
                height: '100%',
              }}
              scrollBufferX={0}
              scrollBufferY={0}
              theme={theme}
              columns={columns}
              freezeColumnCount={0}
              rowCount={rowCount ?? 0}
              rowIndexVisible={false}
              customIcons={customIcons}
              draggable={DraggableType.None}
              selectable={SelectableType.None}
              isMultiSelectionEnable={false}
              onVisibleRegionChanged={onVisibleRegionChanged}
              getCellContent={getCellContent}
            />
          </div>
        </>
      )}
      {mode === 'json' && (
        <div>
          <div className="flex items-center gap-4 pb-4">
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                variant="outline"
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1 || isLoading}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span>
                {page} / {totalPages || 1}
              </span>
              <Button
                size="xs"
                variant="outline"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages || isLoading}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span>skip: {(page - 1) * pageSize}</span>
              <span>take:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded border p-1 text-sm"
                disabled={isLoading}
              >
                {[10, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            {isLoading && <span className="text-sm text-muted-foreground">Loading...</span>}
          </div>
          <CodeBlock
            code={recordRes ? JSON.stringify(recordRes, null, 2) : '// Loading...'}
            language="json"
          />
        </div>
      )}
    </>
  );
};
