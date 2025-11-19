import { useTheme } from '@teable/next-themes';
import { THEMES_KEYS } from '@teable/openapi';
import {
  SelectTrigger,
  SelectValue,
  Select,
  SelectContent,
  SelectItem,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ThemeName } from '@/themes/type';
import { getEchartsTheme } from '../../chart/utils';
import { FormLabel } from './FormLabel';

interface IThemeSelectProps {
  value: string;
  onChange: (value: string) => void;
}
export const ThemeSelect = (props: IThemeSelectProps) => {
  const { value = THEMES_KEYS.BLUE, onChange } = props;
  const { t } = useTranslation('chart');
  const { resolvedTheme } = useTheme();
  const themes = getEchartsTheme(resolvedTheme as ThemeName);

  return (
    <FormLabel label={t('chartV2.appearance.theme')}>
      <div className="px-0.5">
        <Select
          value={value}
          onValueChange={(value: string) => {
            onChange(value);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a theme" className="h-9 w-full" />
          </SelectTrigger>
          <SelectContent className="w-full">
            {themes.map((theme) => (
              <SelectItem key={theme.name} value={theme.name}>
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {theme.colors.map((color, index) => (
                      <div
                        key={index}
                        className="size-4 rounded-sm"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </FormLabel>
  );
};
