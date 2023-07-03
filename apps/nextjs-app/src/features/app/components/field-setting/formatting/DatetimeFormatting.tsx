import type { IDatetimeFormatting } from '@teable-group/core';
import {
  DateFormattingPreset,
  TimeFormatting,
  defaultDatetimeFormatting,
} from '@teable-group/core';
import dayjs from 'dayjs';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const formatStrings: { [key: string]: string } = {
  en: 'MMM D, YYYY', // English
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

function getFormatStringForLanguage(language: string) {
  // If the full language tag is not found, fallback to the base language
  const baseLanguage = language.split('-')[0];
  return formatStrings[language] || formatStrings[baseLanguage] || formatStrings['en']; // Default to 'en'
}

const useDefaultSettings = () => {
  const friendlyDateFormatting = getFormatStringForLanguage(navigator.language);
  const optionsWithExample = (text: string, formatting: string) => {
    return {
      text: `${text} (${dayjs().format(formatting)})`,
      value: formatting,
    };
  };

  const dateFormattingPresetOptions = [
    optionsWithExample('US', DateFormattingPreset.US),
    optionsWithExample('European', DateFormattingPreset.European),
    optionsWithExample('ISO', DateFormattingPreset.ISO),
    optionsWithExample('Friendly', friendlyDateFormatting),
    optionsWithExample('Year/Month', DateFormattingPreset.YM),
    optionsWithExample('Month/Day', DateFormattingPreset.MD),
    optionsWithExample('Year', DateFormattingPreset.Y),
    optionsWithExample('Month', DateFormattingPreset.M),
    optionsWithExample('Day', DateFormattingPreset.D),
  ];

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

  const selectInfoMap: {
    key: 'date' | 'time';
    label: string;
    list: { text: string; value: string }[];
  }[] = [
    {
      key: 'date',
      label: 'Date Formatting',
      list: dateFormattingPresetOptions,
    },
    {
      key: 'time',
      label: 'Time Formatting',
      list: timeFormattingPresetOptions,
    },
  ];

  return {
    selectInfoMap,
  };
};

interface IProps {
  formatting?: IDatetimeFormatting;
  onChange?: (formatting: IDatetimeFormatting) => void;
}
export const DatetimeFormatting: React.FC<IProps> = ({
  formatting = defaultDatetimeFormatting,
  onChange,
}) => {
  const onFormattingChange = (value: string, key: string) => {
    onChange?.({
      ...formatting,
      [key]: value,
    });
  };

  const { selectInfoMap } = useDefaultSettings();

  return (
    <div className="w-full">
      {selectInfoMap.map((item) => {
        const { key, label, list } = item;
        return (
          <div key={key} className="mb-4">
            <Label htmlFor="airplane-mode" className="font-normal">
              {label}
            </Label>
            <Select
              value={formatting[key] as string}
              onValueChange={(value) => onFormattingChange(value, key)}
            >
              <SelectTrigger className="w-full h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {list.map(({ text, value }) => (
                  <SelectItem key={value} value={value}>
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
