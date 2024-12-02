import { FieldType, TimeFormatting } from '@teable/core';
import { useTableId, useTablePermission, useView } from '@teable/sdk/hooks';
import { Field } from '@teable/sdk/model';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import {
  getFormatStringForLanguage,
  localFormatStrings,
  systemTimeZone,
} from '@/features/app/components/field-setting/formatting/DatetimeFormatting';
import { tableConfig } from '@/features/i18n/table.config';
import { useCalendar } from '../hooks';

export const AddDateFieldDialog = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const view = useView();
  const tableId = useTableId();
  const permission = useTablePermission();
  const { startDateField, endDateField } = useCalendar();
  const [open, setOpen] = useState(false);

  const hasDateField = startDateField || endDateField;
  const fieldCreatable = Boolean(permission['field|create']);
  const viewUpdatable = Boolean(permission['view|update']);

  useEffect(() => {
    if (hasDateField || !fieldCreatable) return;
    setOpen(true);
  }, [hasDateField, fieldCreatable]);

  const onClick = async () => {
    if (!tableId) return;

    const localDateFormatting = getFormatStringForLanguage(navigator.language, localFormatStrings);

    const defaultFormatting = {
      date: localDateFormatting,
      time: TimeFormatting.None,
      timeZone: systemTimeZone,
    };

    const startDateField = await Field.createField(tableId, {
      name: t('table:calendar.dialog.startDate'),
      type: FieldType.Date,
      options: {
        formatting: defaultFormatting,
      },
    });
    const endDateField = await Field.createField(tableId, {
      name: t('table:calendar.dialog.endDate'),
      type: FieldType.Date,
      options: {
        formatting: defaultFormatting,
      },
    });

    if (view != null && viewUpdatable) {
      await view.updateOption({
        startDateFieldId: startDateField.data.id,
        endDateFieldId: endDateField.data.id,
      });
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="flex max-w-xl flex-col"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        closeable={false}
      >
        <DialogHeader>
          <DialogTitle>{t('table:calendar.dialog.addDateField')}</DialogTitle>
        </DialogHeader>

        <div className="py-1">{t('table:calendar.dialog.content')}</div>

        <DialogFooter>
          <DialogClose asChild>
            <Button size="sm" type="button" variant="ghost">
              {t('table:calendar.dialog.notAdd')}
            </Button>
          </DialogClose>
          <Button size="sm" onClick={onClick}>
            {t('table:calendar.dialog.addDateField')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
