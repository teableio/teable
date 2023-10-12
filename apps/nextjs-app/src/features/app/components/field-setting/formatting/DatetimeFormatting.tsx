import type { IDatetimeFormatting } from '@teable-group/core';
import { DateFormattingPreset, TimeFormatting } from '@teable-group/core';
import { Label } from '@teable-group/ui-lib/shadcn/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable-group/ui-lib/shadcn/ui/select';
import dayjs from 'dayjs';

// | Locale | Date Format | Notes |
// |--------|-------------|-------|
// | en-US  | M/D/YYYY    | U.S. English (United States), e.g., 12/31/2023 |
// | en-GB  | D/M/YYYY    | British English (United Kingdom, European), e.g., 31/12/2023 |
// | fr-FR  | DD/MM/YYYY  | French (France), e.g., 31/12/2023 |
// | de-DE  | DD.MM.YYYY  | German (Germany), e.g., 31.12.2023 |
// | ja-JP  | YYYY/MM/DD  | Japanese (Japan), e.g., 2023/12/31 |
// | zh-CN  | YYYY-MM-DD  | Simplified Chinese (China), e.g., 2023-12-31 |
// | ko-KR  | YYYY.MM.DD  | Korean (South Korea), e.g., 2023.12.31 |
const localFormatStrings: { [key: string]: string } = {
  en: 'M/D/YYYY',
  'en-GB': 'D/M/YYYY',
  fr: 'DD/MM/YYYY',
  de: 'DD.MM.YYYY',
  ja: 'YYYY/MM/DD',
  zh: 'YYYY-MM-DD',
  ko: 'YYYY.MM.DD',
};

const friendlyFormatStrings: { [key: string]: string } = {
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

function getFormatStringForLanguage(language: string, preset: { [key: string]: string }) {
  // If the full language tag is not found, fallback to the base language
  const baseLanguage = language.split('-')[0];
  return preset[language] || preset[baseLanguage] || preset['en']; // Default to 'en'
}

const useSelectInfoMap = (currentDateFormatting: string) => {
  const friendlyDateFormatting = getFormatStringForLanguage(
    navigator.language,
    friendlyFormatStrings
  );
  const localDateFormatting = getFormatStringForLanguage(navigator.language, localFormatStrings);

  const optionsWithExample = (text: string, formatting: string) => {
    return {
      text: `${text} (${dayjs().format(formatting)})`,
      value: formatting,
    };
  };

  const dateFormattingPresetOptions = [
    optionsWithExample('Local', localDateFormatting),
    optionsWithExample('Friendly', friendlyDateFormatting),
    optionsWithExample('US', DateFormattingPreset.US),
    optionsWithExample('European', DateFormattingPreset.European),
    optionsWithExample('Asia', DateFormattingPreset.Asian),
    optionsWithExample('ISO', DateFormattingPreset.ISO),
    optionsWithExample('Year/Month', DateFormattingPreset.YM),
    optionsWithExample('Month/Day', DateFormattingPreset.MD),
    optionsWithExample('Year', DateFormattingPreset.Y),
    optionsWithExample('Month', DateFormattingPreset.M),
    optionsWithExample('Day', DateFormattingPreset.D),
  ];

  // add [Custom] option if currentDateFormatting not in the list
  if (!dateFormattingPresetOptions.find((option) => option.value === currentDateFormatting)) {
    dateFormattingPresetOptions.push(optionsWithExample('Custom', currentDateFormatting));
  }

  const timeFormattingPresetOptions = [
    {
      text: '24 hour',
      value: TimeFormatting.Hour24,
    },
    {
      text: '12 hour',
      value: TimeFormatting.Hour12,
    },
    {
      text: 'No display',
      value: TimeFormatting.None,
    },
  ];

  return {
    date: {
      label: 'Date Formatting',
      list: dateFormattingPresetOptions,
    },
    time: {
      label: 'Time Formatting',
      list: timeFormattingPresetOptions,
    },
  };
};

interface IProps {
  formatting?: IDatetimeFormatting;
  onChange?: (formatting: IDatetimeFormatting) => void;
}
export const DatetimeFormatting: React.FC<IProps> = ({
  formatting = {
    date: '',
    time: TimeFormatting.None,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  onChange,
}) => {
  const localDateFormatting = getFormatStringForLanguage(navigator.language, localFormatStrings);

  formatting = {
    ...formatting,
    date: formatting.date || localDateFormatting,
  };

  const selectInfoMap = useSelectInfoMap(formatting.date);

  const onFormattingChange = (value: string, typeKey: string) => {
    onChange?.({
      ...formatting,
      [typeKey]: value,
    });
  };

  return (
    <div className="w-full space-y-2">
      {Object.entries(selectInfoMap).map(([typeKey, item]) => {
        const { label, list } = item;
        const formattingString = formatting[typeKey as 'date' | 'time'] as string;
        const formattingTitle = list.find((option) => option.value === formattingString)?.text;
        return (
          <div key={typeKey} className="space-y-2">
            <Label htmlFor="datetime-formatting-select" className="font-normal">
              {label}
            </Label>
            <Select
              value={formattingTitle}
              onValueChange={(text) =>
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                onFormattingChange(list.find((option) => option.text === text)!.value, typeKey)
              }
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {list.map(({ text }) => (
                  <SelectItem key={text} value={text}>
                    {text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
};
