import type { IDatetimeFormatting } from '@teable/core';
import { DateFormattingPreset, TimeFormatting } from '@teable/core';
import { cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@teable/ui-lib';
import { Label } from '@teable/ui-lib/shadcn/ui/label';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { useTranslation } from 'next-i18next';
import { Selector } from '@/components/Selector';
import {
  friendlyFormatStrings,
  getFormatStringForLanguage,
  localFormatStrings,
} from './date-format-strings';
import { TimeZoneFormatting } from './TimeZoneFormatting';

dayjs.extend(utc);
dayjs.extend(timezone);

export const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const useSelectInfoMap = (currentDateFormatting: string) => {
  const { t, i18n } = useTranslation(['common', 'table']);
  const friendlyDateFormatting = getFormatStringForLanguage(i18n.language, friendlyFormatStrings);
  const localDateFormatting = getFormatStringForLanguage(i18n.language, localFormatStrings);

  const optionsWithExample = (text: string, formatting: string) => {
    return {
      text: `${text} (${dayjs().format(formatting)})`,
      value: formatting,
    };
  };

  const dateFormattingPresetOptions = [
    optionsWithExample(t('table:field.default.date.local'), localDateFormatting),
    optionsWithExample(t('table:field.default.date.friendly'), friendlyDateFormatting),
    optionsWithExample(t('table:field.default.date.us'), DateFormattingPreset.US),
    optionsWithExample(t('table:field.default.date.european'), DateFormattingPreset.European),
    optionsWithExample(t('table:field.default.date.asia'), DateFormattingPreset.Asian),
  ];
  if (localDateFormatting !== DateFormattingPreset.ISO) {
    dateFormattingPresetOptions.push(optionsWithExample('ISO', DateFormattingPreset.ISO));
  }
  dateFormattingPresetOptions.push(
    optionsWithExample(t('table:field.default.date.yearMonth'), DateFormattingPreset.YM),
    optionsWithExample(t('table:field.default.date.monthDay'), DateFormattingPreset.MD),
    optionsWithExample(t('table:field.default.date.year'), DateFormattingPreset.Y),
    optionsWithExample(t('table:field.default.date.month'), DateFormattingPreset.M),
    optionsWithExample(t('table:field.default.date.day'), DateFormattingPreset.D)
  );

  // add [Custom] option if currentDateFormatting not in the list
  if (!dateFormattingPresetOptions.find((option) => option.value === currentDateFormatting)) {
    dateFormattingPresetOptions.push(
      optionsWithExample(t('table:field.default.date.custom'), currentDateFormatting)
    );
  }

  const timeFormattingPresetOptions = [
    {
      text: t('table:field.default.date.24Hour'),
      value: TimeFormatting.Hour24,
    },
    {
      text: t('table:field.default.date.12Hour'),
      value: TimeFormatting.Hour12,
    },
    {
      text: t('table:field.default.date.noDisplay'),
      value: TimeFormatting.None,
    },
  ];

  return {
    date: {
      label: t('table:field.default.date.dateFormatting'),
      list: dateFormattingPresetOptions,
    },
    time: {
      label: t('table:field.default.date.timeFormatting'),
      list: timeFormattingPresetOptions,
    },
  };
};

interface IProps {
  formatting?: IDatetimeFormatting;
  onChange?: (formatting: IDatetimeFormatting) => void;
  className?: string;
}
export const DatetimeFormatting: React.FC<IProps> = ({ formatting, onChange, className }) => {
  const localDateFormatting = getFormatStringForLanguage(navigator.language, localFormatStrings);

  formatting = {
    date: formatting?.date || localDateFormatting,
    time: formatting?.time || TimeFormatting.None,
    timeZone: formatting?.timeZone || systemTimeZone,
  };

  const { date, time } = useSelectInfoMap(formatting.date);

  const onFormattingChange = (value: string, typeKey: string) => {
    onChange?.({
      ...formatting,
      [typeKey]: value,
    } as IDatetimeFormatting);
  };

  return (
    <div className={cn('w-full space-y-4 border-t pt-4', className)}>
      <div className="space-y-2">
        <Label className="text-sm font-medium">{date.label}</Label>
        <Selector
          className="w-full"
          candidates={date.list.map((item) => ({ id: item.value, name: item.text }))}
          selectedId={formatting.date}
          onChange={(value) => onFormattingChange(value, 'date')}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-medium">{time.label}</Label>
        <Select
          value={formatting.time}
          onValueChange={(value) => onFormattingChange(value, 'time')}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {time.list.map(({ value, text }) => (
              <SelectItem key={value} value={value}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <TimeZoneFormatting
        timeZone={formatting.timeZone}
        onChange={(value) => onFormattingChange(value, 'timeZone')}
      />
    </div>
  );
};
