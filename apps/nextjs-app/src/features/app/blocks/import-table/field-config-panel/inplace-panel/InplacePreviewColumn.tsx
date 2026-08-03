import { type IFieldVo } from '@teable/core';
import { ArrowLeft } from '@teable/icons';
import type { IInplaceImportOptionRo, IImportOptionRo } from '@teable/openapi';
import { useFieldStaticGetter } from '@teable/sdk';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useEffect } from 'react';
import { FieldSelector } from './FieldSelector';

interface IPreviewColumnProps {
  fields: IFieldVo[];
  workSheets: IImportOptionRo['worksheets'];
  insertConfig: IInplaceImportOptionRo['insertConfig'];
  onChange: (columns: IInplaceImportOptionRo['insertConfig']['sourceColumnMap']) => void;
}

export const InplacePreviewColumn = (props: IPreviewColumnProps) => {
  const { onChange, fields, workSheets, insertConfig } = props;
  const fieldStaticGetter = useFieldStaticGetter();
  const { t } = useTranslation(['table']);

  const columns = fields.map((col) => ({
    label: col.name,
    type: col.type,
    name: col.name,
    id: col.id,
    isComputed: col.isComputed,
    aiConfig: col.aiConfig,
  }));

  const sourceColumnMap = workSheets?.[insertConfig.sourceWorkSheetKey] || {};

  const options =
    sourceColumnMap?.columns?.map((col) => ({
      label: col.name,
      value: col.name,
      icon: fieldStaticGetter(col.type, {
        isLookup: false,
        hasAiConfig: false,
      }).Icon,
    })) || [];

  useEffect(() => {
    const isEmptySourceColumnMap = !Object.keys(insertConfig.sourceColumnMap).length;
    const initSourceColumnMap: Record<string, number | null> = {};
    const analyzeColumns = sourceColumnMap?.columns;
    // init sourceColumnMap automatically
    // TODO add more match logic
    if (isEmptySourceColumnMap && analyzeColumns?.length) {
      columns.forEach((col) => {
        if (!col.isComputed) {
          const matchIndex = analyzeColumns.findIndex(
            (c) => c.name.toLowerCase().trim() === col.name.toLowerCase().trim()
          );
          // only match the same name, others need to be set manually
          initSourceColumnMap[col.id] = matchIndex > -1 ? matchIndex : null;
        }
      });
      onChange(initSourceColumnMap);
    }
  }, [columns, insertConfig.sourceColumnMap, onChange, sourceColumnMap?.columns]);

  return (
    <Table className="relative scroll-smooth">
      <TableHeader>
        <TableRow>
          <TableHead className="shrink-0">{t('table:import.title.primitiveFields')}</TableHead>
          <TableHead></TableHead>
          <TableHead>{t('table:import.title.importFields')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="w-96 overflow-hidden">
        {columns.map((column, index) => {
          const { Icon } = fieldStaticGetter(column.type, {
            isLookup: false,
            hasAiConfig: Boolean(column.aiConfig),
          });
          const selectIndex = insertConfig.sourceColumnMap[column.id] ?? null;
          const value = typeof selectIndex === 'number' ? options[selectIndex].value : null;

          return (
            <TableRow key={index} className="items-center overflow-hidden">
              <TableCell className="w-48 truncate">
                <div className="flex w-48 items-center truncate">
                  <Icon className="size-4 shrink-0" />
                  <div className="flex-1 truncate pl-2">
                    <div className="truncate">{column.name}</div>
                    <span className="truncate text-gray-500">
                      {index === 0 ? t('table:import.title.primaryField') : null}
                    </span>
                  </div>
                </div>
              </TableCell>

              <TableCell>
                <ArrowLeft />
              </TableCell>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TableCell className="w-full max-w-[480px]">
                      <FieldSelector
                        value={value}
                        options={options}
                        disabled={column.isComputed}
                        onSelect={(value) => {
                          const result: Record<string, number | null> = {};
                          const selectedIndex = options.findIndex((o) => o.value === value);
                          result[column.id] = selectedIndex > -1 ? selectedIndex : null;
                          onChange(result);
                        }}
                      />
                      {column.isComputed && (
                        <TooltipContent>
                          <p>{t('table:import.tips.notSupportFieldType')}</p>
                        </TooltipContent>
                      )}
                    </TableCell>
                  </TooltipTrigger>
                </Tooltip>
              </TooltipProvider>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};
