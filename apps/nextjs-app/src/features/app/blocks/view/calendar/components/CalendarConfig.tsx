import type { IColorConfig } from '@teable/core';
import { CellValueType, ColorConfigType, Colors, FieldType } from '@teable/core';
import { useFields, useFieldStaticGetter, useView } from '@teable/sdk/hooks';
import type { CalendarView } from '@teable/sdk/model';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  Select,
  SelectItem,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { FC, PropsWithChildren } from 'react';
import { Fragment, useMemo } from 'react';
import { ColorPicker } from '@/features/app/components/field-setting/options/SelectOptions';
import { tableConfig } from '@/features/i18n/table.config';
import { useCalendarFields } from '../hooks';

export const DEFAULT_COLOR = Colors.PurpleLight2;

export const CalendarConfig: FC<PropsWithChildren> = (props) => {
  const { children } = props;
  const { startDateField, endDateField, titleField, colorConfig } = useCalendarFields();
  const view = useView() as CalendarView | undefined;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const fields = useFields({ withHidden: true, withDenied: true });
  const fieldStaticGetter = useFieldStaticGetter();

  const { primaryField, filteredDateFields, filteredSelectFields } = useMemo(
    () => ({
      primaryField: fields.find((field) => field.isPrimary)!,
      filteredDateFields: fields.filter(
        (field) => field.cellValueType === CellValueType.DateTime && !field.isMultipleCellValue
      ),
      filteredSelectFields: fields.filter(
        (field) => field.type === FieldType.SingleSelect && !field.isMultipleCellValue
      ),
    }),
    [fields]
  );

  const onSelectChange = (key: string, value: string) => {
    view?.updateOption({ [key]: value });
  };

  const onColorTypeChange = (type: ColorConfigType) => {
    let config: IColorConfig = null;

    if (type === ColorConfigType.Field) {
      const singleSelectField = fields.find(
        ({ type, isMultipleCellValue }) => type === FieldType.SingleSelect && !isMultipleCellValue
      );
      config = { type, fieldId: singleSelectField?.id };
    } else {
      config = { type, color: DEFAULT_COLOR };
    }

    view?.updateOption({ colorConfig: config });
  };

  const onColorChange = (value: string) => {
    view?.updateOption({ colorConfig: { type: ColorConfigType.Custom, color: value as Colors } });
  };

  const onColorFieldIdChange = (value: string) => {
    view?.updateOption({
      colorConfig: { type: ColorConfigType.Field, color: null, fieldId: value },
    });
  };

  const dateSelects = [
    {
      label: t('table:calendar.toolbar.startDateField'),
      key: 'startDateFieldId',
      value: startDateField?.id,
    },
    {
      label: t('table:calendar.toolbar.endDateField'),
      key: 'endDateFieldId',
      value: endDateField?.id,
    },
  ];

  const colorTypeSelects = [
    { label: t('table:calendar.toolbar.customColor'), value: ColorConfigType.Custom },
    { label: t('table:calendar.toolbar.alignWithRecords'), value: ColorConfigType.Field },
  ];

  const {
    type: colorType = ColorConfigType.Custom,
    fieldId: colorFieldId,
    color,
  } = colorConfig ?? {};

  return (
    <Popover modal>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="flex w-[272px] flex-col gap-y-2 p-4">
        {fields.length > 0 ? (
          <Fragment>
            {dateSelects.map(({ label, key, value }) => (
              <div key={key} className="flex flex-col gap-y-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Select
                  value={value ?? undefined}
                  onValueChange={(value) => onSelectChange(key, value)}
                >
                  <SelectTrigger className="h-8 w-full bg-background">
                    <SelectValue placeholder={t('sdk:editor.date.placeholder')} />
                  </SelectTrigger>
                  <SelectContent className="w-full">
                    {filteredDateFields.map(({ id, type, name, isLookup }) => {
                      const { Icon } = fieldStaticGetter(type, isLookup);
                      return (
                        <SelectItem key={id} value={id}>
                          <div className="flex flex-row items-center text-[13px]">
                            <Icon className="size-5 shrink-0 pr-1" />
                            {name}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="flex flex-col gap-y-1">
              <span className="text-xs text-muted-foreground">
                {t('table:calendar.toolbar.titleField')}
              </span>
              <Select
                value={titleField?.id ?? primaryField.id}
                onValueChange={(value) => onSelectChange('titleFieldId', value)}
              >
                <SelectTrigger className="h-8 w-full bg-background">
                  <SelectValue placeholder={t('sdk:editor.date.placeholder')} />
                </SelectTrigger>
                <SelectContent className="w-full">
                  {fields.map(({ id, type, name, isLookup }) => {
                    const { Icon } = fieldStaticGetter(type, isLookup);
                    return (
                      <SelectItem key={id} value={id}>
                        <div className="flex flex-row items-center text-[13px]">
                          <Icon className="size-5 shrink-0 pr-1" />
                          {name}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-y-1">
              <span className="text-xs text-muted-foreground">
                {t('table:calendar.toolbar.colorType')}
              </span>
              <Select
                value={colorType}
                onValueChange={(value) => onColorTypeChange(value as ColorConfigType)}
              >
                <SelectTrigger className="h-8 w-full bg-background">
                  <SelectValue placeholder={t('sdk:editor.date.placeholder')} />
                </SelectTrigger>
                <SelectContent className="w-full">
                  {colorTypeSelects.map(({ label, value }) => (
                    <SelectItem key={value} value={value} className="text-sm">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {colorType === ColorConfigType.Custom && (
              <ColorPicker
                color={color ?? DEFAULT_COLOR}
                onSelect={(color) => onColorChange(color)}
                className="p-0"
              />
            )}
            {colorType === ColorConfigType.Field && (
              <div className="flex flex-col gap-y-1">
                <span className="text-xs text-muted-foreground">
                  {t('table:calendar.toolbar.colorField')}
                </span>
                <Select
                  value={colorFieldId ?? filteredSelectFields[0]?.id}
                  onValueChange={(value) => onColorFieldIdChange(value)}
                >
                  <SelectTrigger className="h-8 w-full bg-background">
                    <SelectValue placeholder={t('table:calendar.placeholder.selectColorField')} />
                  </SelectTrigger>
                  <SelectContent className="w-full">
                    {filteredSelectFields.map(({ id, type, name, isLookup }) => {
                      const { Icon } = fieldStaticGetter(type, isLookup);
                      return (
                        <SelectItem key={id} value={id}>
                          <div className="flex flex-row items-center text-[13px]">
                            <Icon className="size-5 shrink-0 pr-1" />
                            {name}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}
          </Fragment>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};
