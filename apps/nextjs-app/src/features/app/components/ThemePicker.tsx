import { ThemeKey, useTheme } from '@teable/sdk';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn/ui/dropdown-menu';
import classNames from 'classnames';
export const ThemePicker: React.FC<{ className?: string }> = ({ className }) => {
  const { theme, isAutoTheme, setTheme } = useTheme();
  const value = isAutoTheme ? '' : theme;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={classNames('capitalize', className)} size={'xs'} variant="ghost">
          {value || 'system'}
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
                className="capitalize"
                key={item}
                disabled={!isAutoTheme && theme === item}
                value={item}
              >
                {item}
              </DropdownMenuRadioItem>
            );
          })}
          <DropdownMenuRadioItem disabled={isAutoTheme} value="">
            system
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
