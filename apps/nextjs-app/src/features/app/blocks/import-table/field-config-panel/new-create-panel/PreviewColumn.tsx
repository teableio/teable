import { IMPORT_SUPPORTED_TYPES } from '@teable/core';
import type { FieldType } from '@teable/core';
import { Trash2, Lock } from '@teable/icons';
import type { IImportColumn } from '@teable/openapi';
import { useFieldStaticGetter } from '@teable/sdk';
import { BaseSingleSelect } from '@teable/sdk/components/filter/view-filter/component/base/BaseSingleSelect';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  Input,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

interface IPreviewColumnProps {
  columns: IImportColumn[];
  onChange: (columns: IImportColumn[]) => void;
}

export const PreviewColumn = (props: IPreviewColumnProps) => {
  const { columns, onChange } = props;
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(['table', 'common']);
  const candidates = useMemo(
    () =>
      IMPORT_SUPPORTED_TYPES.map<{ value: FieldType; label: string; icon: JSX.Element }>((type) => {
        const { title, Icon } = getFieldStatic(type, {
          isLookup: false,
          hasAiConfig: false,
        });
        return {
          value: type,
          label: title,
          icon: <Icon />,
        };
      }),
    [getFieldStatic]
  );

  const onChangeHandler = (data: IImportColumn[]) => {
    onChange(data);
  };

  return (
    <Table className="table-fixed scroll-smooth">
      <colgroup>
        <col style={{ width: 'calc((100% - 3rem) / 2)' }} />
        <col style={{ width: 'calc((100% - 3rem) / 2)' }} />
        <col className="w-12" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead className="ps-4">{t('table:field.fieldName')}</TableHead>
          <TableHead className="ps-4">{t('table:field.fieldType')}</TableHead>
          <TableHead className="text-end"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {columns.map((column, index) => (
          <TableRow key={index} className="h-14">
            <TableCell className="relative ps-4 font-medium">
              <Input
                placeholder="fieldName"
                value={column.name}
                onChange={(e) => {
                  const newColumns = [...columns];
                  newColumns[index].name = e.target.value;
                  onChangeHandler(newColumns);
                }}
              />
            </TableCell>
            <TableCell className="ps-4">
              <BaseSingleSelect
                modal
                className="w-full"
                options={candidates}
                popoverClassName="max-w-[calc(100vw-2rem)] w-96 truncate"
                value={column.type}
                onSelect={(value) => {
                  const newColumns = [...columns];
                  newColumns[index].type = value as FieldType;
                  onChangeHandler(newColumns);
                }}
                optionRender={(option) => {
                  return (
                    <div className="flex items-center truncate">
                      <span className="me-1 shrink-0">{option.icon}</span>
                      <span>{option.label}</span>
                    </div>
                  );
                }}
              ></BaseSingleSelect>
            </TableCell>
            <TableCell className="w-12 text-end">
              <Button
                variant="ghost"
                size="xs"
                disabled={index === 0}
                onClick={() => {
                  const newColumns = [...columns];
                  newColumns.splice(index, 1);
                  onChange(newColumns);
                }}
              >
                {index === 0 ? <Lock className="size-4" /> : <Trash2 className="size-4" />}
                <span className="sr-only">
                  {index === 0 ? t('table:import.title.primaryField') : t('common:actions.delete')}
                </span>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
