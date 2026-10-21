import type { IRecord } from '@teable/core';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import type { IFieldInstance } from '../../model';
import { CellValue } from '../cell-value';

export interface IRecordSnapshotExpandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  // Contextual line above the field list, e.g. "deleted time · deleted by".
  meta?: ReactNode;
  fields: IFieldInstance[];
  // The caller keeps the record set while the close animation plays; only `open`
  // drives the dialog, otherwise the closing dialog flashes empty.
  record?: IRecord;
}

export const RecordSnapshotExpandDialog = (props: IRecordSnapshotExpandDialogProps) => {
  const { open, onOpenChange, title, meta, fields, record } = props;
  const { t } = useTranslation();

  const fieldValues = useMemo(() => {
    if (!record) return [];
    return fields.map((field) => {
      const validated = field.validateCellValue(record.fields[field.id]);
      return { field, cellValue: validated.success ? validated.data : undefined };
    });
  }, [record, fields]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80%] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b p-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {meta}
          {fieldValues.map(({ field, cellValue }) => (
            <div key={field.id} className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{field.name}</div>
              {cellValue != null ? (
                <CellValue value={cellValue} field={field} />
              ) : (
                <span className="text-xs text-muted-foreground">{t('common.empty')}</span>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
