import { type IFieldVo, FieldType } from '@teable/core';
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
import { FieldSelector } from './FieldSelector';

interface IPreviewColumnProps {
  fields: IFieldVo[];
  workSheets: IImportOptionRo['worksheets'];
  insertConfig: IInplaceImportOptionRo['insertConfig'];
  onChange: (columns: IInplaceImportOptionRo['insertConfig']['sourceColumnMap']) => void;
}

const UNSUPPORTFIELDTYPES = [FieldType.User, FieldType.Link, FieldType.Rollup, FieldType.Formula];

export const InplacePreviewColumn = (props: IPreviewColumnProps) => {
  const { onChange, fields, workSheets, insertConfig } = props;
  const fieldStaticGetter = useFieldStaticGetter();
  const { t } = useTranslation(['table']);

  const columns = fields.map((col) => ({
    label: col.name,
    type: col.type,
    name: col.name,
    id: col.id,
  }));

  const sourceColumnMap = workSheets?.[insertConfig.sourceWorkSheetKey] || {};

  const options =
    sourceColumnMap?.columns?.map((col) => ({
      label: col.name,
      value: col.name,
      icon: fieldStaticGetter(col.type, false).Icon,
    })) || [];

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
          const { Icon } = fieldStaticGetter(column.type, false);
          const selectIndex = insertConfig.sourceColumnMap[column.id] ?? null;
          const value = typeof selectIndex === 'number' ? options[selectIndex].value : null;

          return (
            <TableRow key={index} className="items-center overflow-hidden">
              <TableCell className="w-48 truncate">
                <div className="flex w-48 items-center truncate">
                  <Icon className="shrink-0" />
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
                        disabled={UNSUPPORTFIELDTYPES.includes(column.type)}
                        onSelect={(value) => {
                          const result: Record<string, number | null> = {};
                          const selectedIndex = options.findIndex((o) => o.value === value);
                          result[column.id] = selectedIndex > -1 ? selectedIndex : null;
                          onChange(result);
                        }}
                      />
                      {UNSUPPORTFIELDTYPES.includes(column.type) && (
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
