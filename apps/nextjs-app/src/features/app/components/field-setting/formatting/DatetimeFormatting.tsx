import type { IDatetimeFormatting } from '@teable/core';
import { DateFormattingPreset, TimeFormatting } from '@teable/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@teable/ui-lib';
import { Label } from '@teable/ui-lib/shadcn/ui/label';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { useTranslation } from 'next-i18next';
import { Selector } from '@/components/Selector';
import { TimeZoneFormatting } from './TimeZoneFormatting';
dayjs.extend(utc);
dayjs.extend(timezone);

export const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// | Locale | Date Format | Notes |
// |--------|-------------|-------|
// | en-US  | M/D/YYYY    | U.S. English (United States), e.g., 12/31/2023 |
// | en-GB  | D/M/YYYY    | British English (United Kingdom, European), e.g., 31/12/2023 |
// | fr-FR  | DD/MM/YYYY  | French (France), e.g., 31/12/2023 |
// | de-DE  | DD.MM.YYYY  | German (Germany), e.g., 31.12.2023 |
// | ja-JP  | YYYY/MM/DD  | Japanese (Japan), e.g., 2023/12/31 |
// | zh-CN  | YYYY-MM-DD  | Simplified Chinese (China), e.g., 2023-12-31 |
// | ko-KR  | YYYY.MM.DD  | Korean (South Korea), e.g., 2023.12.31 |
export const localFormatStrings: { [key: string]: string } = {
  en: 'M/D/YYYY',
  'en-GB': 'D/M/YYYY',
  fr: 'DD/MM/YYYY',
  de: 'DD.MM.YYYY',
  ja: 'YYYY/MM/DD',
  zh: 'YYYY-MM-DD',
  ko: 'YYYY.MM.DD',
};

export const friendlyFormatStrings: { [key: string]: string } = {
  en: 'MMMM D, YYYY', // English
  'en-GB': 'D MMMM YYYY', // English GB
  zh: 'YYYY 年 M 月 D 日', // Chinese
  fr: 'D MMM YYYY', // French
  de: 'D. MMM YYYY', // German
  es: 'D de MMM de YYYY', // Spanish
  ru: 'D MMM YYYY г.', // Russian
  ja: 'YYYY 年 M 月 D 日', // Japanese
  ar: 'D MMMM, YYYY', // Arabic
  pt: 'D de MMMM de YYYY', // Portuguese
  hi: 'D MMMM, YYYY', // Hindi
  bn: 'D MMMM, YYYY', // Bengali
  jv: 'D MMMM YYYY', // Javanese
  pa: 'D MMMM YYYY', // Punjabi
  mr: 'D MMMM, YYYY', // Marathi
  ta: 'D MMMM, YYYY', // Tamil
};

export function getFormatStringForLanguage(language: string, preset: { [key: string]: string }) {
  // If the full language tag is not found, fallback to the base language
  const baseLanguage = language.split('-')[0];
  return preset[language] || preset[baseLanguage] || preset['en']; // Default to 'en'
}

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
}
export const DatetimeFormatting: React.FC<IProps> = ({ formatting, onChange }) => {
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
    <div className="w-full space-y-2">
      <div className="space-y-2">
        <Label className="font-normal">{date.label}</Label>
        <Selector
          className="w-full"
          candidates={date.list.map((item) => ({ id: item.value, name: item.text }))}
          selectedId={formatting.date}
          onChange={(value) => onFormattingChange(value, 'date')}
        />
      </div>
      <div className="space-y-2">
        <Label className="font-normal">{time.label}</Label>
        <Select
          value={formatting.time}
          onValueChange={(value) => onFormattingChange(value, 'time')}
        >
          <SelectTrigger className="h-8 w-full">
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
