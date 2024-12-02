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
  const { t } = useTranslation(['table']);
  const candidates = useMemo(
    () =>
      IMPORT_SUPPORTED_TYPES.map<{ value: FieldType; label: string; icon: JSX.Element }>((type) => {
        const { title, Icon } = getFieldStatic(type, false);
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
    <Table className="scroll-smooth">
      <TableHeader>
        <TableRow>
          <TableHead className="w-56">{t('table:field.fieldName')}</TableHead>
          <TableHead>{t('table:field.fieldType')}</TableHead>
          <TableHead className="text-right"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {columns.map((column, index) => (
          <TableRow key={index}>
            <TableCell className="relative min-w-56 font-medium">
              <Input
                placeholder="fieldName"
                className="h-8"
                value={column.name}
                onChange={(e) => {
                  const newColumns = [...columns];
                  newColumns[index].name = e.target.value;
                  onChangeHandler(newColumns);
                }}
              />
            </TableCell>
            <TableCell className="w-full max-w-md">
              <BaseSingleSelect
                className="m-1 w-full"
                options={candidates}
                popoverClassName="w-96 truncate"
                value={column.type}
                onSelect={(value) => {
                  const newColumns = [...columns];
                  newColumns[index].type = value as FieldType;
                  onChangeHandler(newColumns);
                }}
                optionRender={(option) => {
                  return (
                    <div className="flex items-center truncate">
                      <span className="mr-1 shrink-0">{option.icon}</span>
                      <span>{option.label}</span>
                    </div>
                  );
                }}
              ></BaseSingleSelect>
            </TableCell>
            <TableCell className="text-right">
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
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
