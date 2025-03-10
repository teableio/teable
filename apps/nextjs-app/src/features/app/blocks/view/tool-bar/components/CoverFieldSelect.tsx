import { FieldType } from '@teable/core';
import { useFields } from '@teable/sdk/hooks';
import {
  Label,
  Select,
  SelectItem,
  SelectContent,
  SelectTrigger,
  SelectValue,
  Switch,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface ICoverFieldSelect {
  fieldId?: string | null;
  isCoverFit?: boolean;
  className?: string;
  onSelectChange?: (fieldId: string | null) => void;
  onCheckedChange?: (checked: boolean) => void;
}

const COVER_FIELD_EMPTY_ID = 'cover_field_empty_id';

export const CoverFieldSelect = (props: ICoverFieldSelect) => {
  const { fieldId, isCoverFit, className, onCheckedChange, onSelectChange } = props;
  const allFields = useFields({ withHidden: true, withDenied: true });
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const filteredFields = useMemo(
    () => allFields.filter((f) => f.type === FieldType.Attachment),
    [allFields]
  );

  return (
    <div className={cn('w-full p-2', className)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm">{t('table:kanban.toolbar.imageSetting')}</span>
        {fieldId && (
          <div className="flex items-center gap-2">
            <Label htmlFor="attachment-field-select" className="text-xs font-normal text-slate-400">
              {t('table:kanban.toolbar.fit')}
            </Label>
            <Switch
              id="attachment-field-select"
              className="h-4 w-7"
              classNameThumb="size-3 data-[state=checked]:translate-x-3"
              checked={isCoverFit}
              onCheckedChange={(checked) => onCheckedChange?.(checked)}
            />
          </div>
        )}
      </div>
      <Select
        value={fieldId ?? undefined}
        onValueChange={(value) => onSelectChange?.(value === COVER_FIELD_EMPTY_ID ? null : value)}
      >
        <SelectTrigger className="h-8 w-full bg-background">
          <SelectValue placeholder={t('table:kanban.toolbar.chooseAttachmentField')} />
        </SelectTrigger>
        <SelectContent className=" w-72">
          {filteredFields.map(({ id, name }) => (
            <SelectItem key={id} value={id} className="text-sm">
              {name}
            </SelectItem>
          ))}
          <SelectItem value={COVER_FIELD_EMPTY_ID} className="flex">
            {t('table:kanban.toolbar.noImage')}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
