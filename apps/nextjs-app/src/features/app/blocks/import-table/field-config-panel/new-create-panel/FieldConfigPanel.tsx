import { FieldType } from '@teable/core';
import { ArrowLeft, X } from '@teable/icons';
import type { IImportOption, IImportOptionRo, IImportSheetItem } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useState, useRef } from 'react';
import { ImportOptionPanel } from '../CollapsePanel';
import { PreviewColumn } from './PreviewColumn';

export type ITableImportOptions = IImportOption & {
  autoSelectType: boolean;
};

interface IFieldConfigPanel {
  className?: string;
  tableId?: string;
  workSheets: IImportOptionRo['worksheets'];
  errorMessage: string;
  onBack?: () => void;
  onChange: (sheets: IImportOptionRo['worksheets']) => void;
}

const FieldConfigPanel = (props: IFieldConfigPanel) => {
  const { className, onBack, onChange, workSheets, errorMessage } = props;
  const { t } = useTranslation(['table', 'common']);
  const [autoSelectTypes, setAutoSelectTypes] = useState<Record<string, boolean>>({});
  const [selectedSheetKey, setSelectedSheetKey] = useState(Object.keys(workSheets)[0]);
  const lastColumnsMap = useRef<Record<string, IImportSheetItem>>(workSheets);

  const data = workSheets[selectedSheetKey];

  const options = {
    importData: data.importData,
    useFirstRowAsHeader: data.useFirstRowAsHeader,
    autoSelectType: autoSelectTypes[selectedSheetKey] ?? true,
  };

  const sheets = Object.keys(workSheets);

  const columnHandler = (columns: IImportSheetItem['columns']) => {
    const newSheets = { ...workSheets };
    newSheets[selectedSheetKey].columns = columns;
    onChange(newSheets);
  };

  const optionHandler = (value: boolean, propertyName: keyof ITableImportOptions) => {
    const updateSheet = () => {
      const newSheets = {
        ...workSheets,
        [selectedSheetKey]: { ...workSheets[selectedSheetKey], [propertyName]: value },
      };
      onChange(newSheets);
    };
    switch (propertyName) {
      case 'importData':
        updateSheet();
        break;
      case 'autoSelectType':
        {
          const newColumns = !value
            ? data.columns.map((column) => ({
                ...column,
                type: FieldType.SingleLineText,
              }))
            : lastColumnsMap.current[selectedSheetKey].columns;
          setAutoSelectTypes({ ...autoSelectTypes, [selectedSheetKey]: value });
          onChange({
            ...workSheets,
            [selectedSheetKey]: { ...workSheets[selectedSheetKey], columns: newColumns },
          });
        }
        break;
      case 'useFirstRowAsHeader':
        {
          const newColumns = !value
            ? data.columns.map((column, index) => ({
                ...column,
                name: `${t('table:import.form.defaultFieldName')} ${index + 1}`,
              }))
            : lastColumnsMap.current[selectedSheetKey].columns;

          onChange({
            ...workSheets,
            [selectedSheetKey]: {
              ...workSheets[selectedSheetKey],
              [propertyName]: value,
              columns: newColumns,
            },
          });
        }
        break;
      default:
        break;
    }
  };

  const removeSheet = (sheetKey: string) => {
    const newSheets = { ...workSheets };
    delete newSheets[sheetKey];
    const newSheetsKeys = Object.keys(newSheets);
    if (selectedSheetKey === sheetKey) {
      setSelectedSheetKey(newSheetsKeys[0]);
    }
    onChange(newSheets);
  };

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}>
      {onBack && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="mb-2 w-fit px-1 text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t('common:actions.back')}
        </Button>
      )}

      <div className="relative flex w-full gap-2 overflow-x-auto">
        {sheets.map((sheetKey) => (
          <div key={sheetKey} className="relative flex max-w-32 shrink-0">
            <Button
              variant="outline"
              size="xs"
              aria-pressed={sheetKey === selectedSheetKey}
              onClick={() => setSelectedSheetKey(sheetKey)}
              className={cn(
                'max-w-32 cursor-pointer truncate rounded-sm px-2',
                sheets.length !== 1 && 'pe-7',
                { 'bg-secondary': sheetKey === selectedSheetKey }
              )}
              title={workSheets[sheetKey].name}
            >
              <span className="truncate">{workSheets[sheetKey].name}</span>
            </Button>
            {sheets.length !== 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute end-0 top-0 size-7 rounded-s-none hover:bg-transparent"
                aria-label={`${t('common:actions.delete')}: ${workSheets[sheetKey].name}`}
                onClick={() => removeSheet(sheetKey)}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="mb-2 mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border">
        <PreviewColumn columns={data.columns} onChange={columnHandler}></PreviewColumn>
      </div>

      {errorMessage && <p className="ps-2 text-sm text-red-500">{errorMessage}</p>}

      <ImportOptionPanel onChange={optionHandler} options={options} />
    </div>
  );
};

export { FieldConfigPanel };
