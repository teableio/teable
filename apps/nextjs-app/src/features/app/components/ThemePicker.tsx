import { useTheme } from '@teable/next-themes';
import { cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn/ui/dropdown-menu';
export const ThemePicker: React.FC<{ className?: string }> = ({ className }) => {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={cn('capitalize', className)} size={'xs'} variant="ghost">
          {theme || 'system'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            setTheme(value);
          }}
        >
          {['light', 'dark', 'system'].map((item) => {
            return (
              <DropdownMenuRadioItem
                className="capitalize"
                key={item}
                disabled={theme === item}
                value={item}
              >
                {item}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
