import { ThemeKey, useTheme } from '@teable-group/sdk';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@teable-group/ui-lib/shadcn/ui/dropdown-menu';
export const ThemePicker: React.FC = () => {
  const { theme, isAutoTheme, setTheme } = useTheme();
  const value = isAutoTheme ? '' : theme;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={'xs'} variant="outline">
          {value || 'auto'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(value) => {
            setTheme(value === '' ? null : (value as ThemeKey));
          }}
        >
          {[ThemeKey.Light, ThemeKey.Dark].map((item) => {
            return (
              <DropdownMenuRadioItem
                key={item}
                disabled={!isAutoTheme && theme === item}
                value={item}
              >
                {item}
              </DropdownMenuRadioItem>
            );
          })}
          <DropdownMenuRadioItem disabled={isAutoTheme} value="">
            auto
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
