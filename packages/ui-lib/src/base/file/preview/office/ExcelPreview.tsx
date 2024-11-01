import type { GridCell, Item } from '@glideapps/glide-data-grid';
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid';
import React, { useCallback, useEffect, useMemo, useState, useContext } from 'react';
import * as XLSX from 'xlsx';
import { Button, cn, Skeleton } from '../../../../shadcn';
import { Spin } from '../../../spin/Spin';
import { FilePreviewContext, type IFileItemInner } from '../FilePreviewContext';
import { getFileIcon } from '../getFileIcon';
import {
  numberCoordinate2Letter,
  getBlobFromUrl,
  getEndColumn,
  letterCoordinate2Number,
} from './utils';

type ISheetData = XLSX.WorkSheet;

interface ISheetItem {
  name: string;
  data: ISheetData;
}

interface IExcelPreviewProps extends IFileItemInner {}

export const ExcelPreview = (props: IExcelPreviewProps) => {
  const { src, mimetype } = props;
  const [error, setError] = useState<string | null>(null);
  const [currentSheetName, setCurrentSheetName] = useState<string | null>(null);
  const [sheetList, setSheetList] = useState<ISheetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const FileIcon = useMemo(() => (mimetype ? getFileIcon(mimetype) : ''), [mimetype]);
  const { i18nMap } = useContext(FilePreviewContext);

  const currentSheetData = useMemo<ISheetData>(() => {
    return sheetList.find((sheet) => sheet.name === currentSheetName)?.data as ISheetData;
  }, [sheetList, currentSheetName]);

  const cols = useMemo(() => {
    if (!currentSheetData) {
      return [];
    }
    const ref = currentSheetData['!ref'];

    if (!ref) {
      return [];
    }

    const letter = getEndColumn(ref);
    const colNum = letterCoordinate2Number(letter!);

    return (
      Array.from({ length: colNum }).map((_, index) => ({
        title: numberCoordinate2Letter(index + 1),
        id: numberCoordinate2Letter(index + 1),
      })) || []
    );
  }, [currentSheetData]);

  useEffect(() => {
    const fetchAndParseExcel = async () => {
      try {
        setError(null);
        setLoading(true);
        const blob = await getBlobFromUrl(src);
        const buffer = await blob.arrayBuffer();

        if (blob.size > 1024 * 1024 * 10) {
          const errorText =
            i18nMap?.['previewFileLimit'] ||
            'File is too large to preview, please download it instead.';
          setError(errorText);
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
        setError(i18nMap?.['loadFileError'] || 'Failed to load file');
      }
    };

    fetchAndParseExcel();
  }, [i18nMap, src]);

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
        allowOverlay: true,
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
          getCellContent={(cell) => getData(cell)}
          columns={cols}
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
