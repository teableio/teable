import type { GridCell, Item } from '@glideapps/glide-data-grid';
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Button, cn, Skeleton } from '../../../../shadcn';
import { Spin } from '../../../spin/Spin';
import type { IFileItemInner } from '../FilePreviewContext';
import { getFileIcon } from '../getFileIcon';
import { numberCoordinate2Letter, getBlobFromUrl } from './utils';

interface ISheetItem {
  name: string;
  data: XLSX.WorkSheet;
}

interface IExcelPreviewProps extends IFileItemInner {}

export const ExcelPreview = (props: IExcelPreviewProps) => {
  const { src, mimetype } = props;
  const [error, setError] = useState<string | null>(null);
  const [currentSheetName, setCurrentSheetName] = useState<string | null>(null);
  const [sheetList, setSheetList] = useState<ISheetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const FileIcon = useMemo(() => (mimetype ? getFileIcon(mimetype) : ''), [mimetype]);

  const currentSheetData = useMemo<XLSX.CellObject[][]>(() => {
    return (sheetList.find((sheet) => sheet.name === currentSheetName)?.data ||
      []) as XLSX.CellObject[][];
  }, [sheetList, currentSheetName]);

  useEffect(() => {
    const fetchAndParseExcel = async () => {
      try {
        setError(null);
        setLoading(true);
        const blob = await getBlobFromUrl(src);
        const buffer = await blob.arrayBuffer();

        if (blob.size > 1024 * 1024 * 10) {
          setError('File is too large to preview, please download it instead.');
          return;
        }

        const workbook = XLSX.read(buffer, { dense: true });

        const newSheetList: ISheetItem[] = [];

        Object.keys(workbook.Sheets).forEach((name, index) => {
          if (index === 0) {
            setCurrentSheetName(name);
          }
          const sheet = workbook.Sheets[name];
          const item = {
            name: name,
            data: sheet,
          };
          newSheetList.push(item);
        });

        setSheetList(newSheetList);
      } catch (e) {
        console.error('Failed to load Excel file:', e);
        setError('loading error');
      }
    };

    fetchAndParseExcel();
  }, [src]);

  const getData = useCallback(
    ([col, row]: Item): GridCell => {
      if (setLoading) {
        setLoading(false);
      }
      const rowData = currentSheetData?.[row] || {};
      const cellData = (rowData?.[col] || {}) as XLSX.CellObject;

      const value = (cellData?.w ?? cellData?.v ?? '') as string;

      return {
        kind: GridCellKind.Text,
        data: value,
        allowOverlay: false,
        displayData: value,
      };
    },
    [currentSheetData]
  );

  if (error) {
    return (
      <div className="size-full text-red-500 items-center justify-center flex flex-col">
        {FileIcon && <FileIcon className="max-w-max max-h-max w-40 h-40" />}
        {error}
      </div>
    );
  }

  return (
    <div className="size-full bg-secondary rounded-sm relative pb-7">
      {loading && (
        <div className="size-full absolute z-50">
          <Skeleton className="size-full" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <Spin />
          </div>
        </div>
      )}
      {currentSheetData && (
        <DataEditor
          className={cn('size-full rounded-sm', {
            'opacity-0': loading,
          })}
          rowMarkers={'number'}
          smoothScrollX={true}
          smoothScrollY={true}
          overscrollX={0}
          overscrollY={0}
          fixedShadowY={false}
          fixedShadowX={true}
          experimental={{
            paddingRight: 10,
            paddingBottom: 10,
          }}
          verticalBorder={true}
          getCellContent={getData}
          columns={
            currentSheetData[0]?.map((_, index) => ({
              title: numberCoordinate2Letter(index + 1),
              id: numberCoordinate2Letter(index + 1),
            })) || []
          }
          rows={currentSheetData.length}
        />
      )}

      <div className="bottom-0 absolute w-full overflow-x-auto rounded-sm">
        {sheetList.map((sheet) => (
          <Button
            variant={'outline'}
            size={'xs'}
            key={sheet.name}
            className={cn('text-muted-foreground rounded-none bg-secondary', {
              'bg-card': currentSheetName === sheet.name,
            })}
            onClick={() => {
              if (currentSheetName === sheet.name) {
                return;
              }
              setCurrentSheetName(sheet.name);
            }}
          >
            {sheet.name}
          </Button>
        ))}
      </div>
    </div>
  );
};
