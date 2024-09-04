import { LaptopIcon } from '@radix-ui/react-icons';
import { Moon, Settings, Sun, Table2 } from '@teable/icons';
import { useTheme } from '@teable/next-themes';
import { useBase, useIsHydrated, useTables } from '@teable/sdk/hooks';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  Button,
  cn,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useSettingStore } from '@/features/app/components/setting/useSettingStore';
import { useModKeyStr } from '@/features/app/utils/get-mod-key-str';
import { tableConfig } from '@/features/i18n/table.config';

export const QuickAction = ({ children }: React.PropsWithChildren) => {
  const [open, setOpen] = useState(false);
  const tables = useTables();
  const base = useBase();
  const setting = useSettingStore();
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const modKeyStr = useModKeyStr();
  useHotkeys(
    `mod+k`,
    () => {
      setOpen(!open);
    },
    {
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  const isHydrated = useIsHydrated();

  return (
    <>
      <Button
        className="w-full justify-between text-sm font-normal text-muted-foreground shadow-none"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        {children}
        {isHydrated && (
          <kbd className="flex h-5 items-center gap-1 rounded border bg-muted px-2 font-mono text-xs">
            <span className={cn({ 'text-sm': modKeyStr === '⌘' })}>{modKeyStr}</span>
            <span>K</span>
          </kbd>
        )}
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={t('common:quickAction.placeHolder')} />
        <CommandList>
          <CommandEmpty>{t('common:noResult')}</CommandEmpty>
          <CommandGroup heading={t('common:noun.table')}>
            {tables.map((table) => (
              <CommandItem
                className="flex gap-2"
                key={table.id}
                value={table.name}
                onSelect={() => {
                  setOpen(false);
                  router.push({
                    pathname: '/base/[baseId]/[tableId]',
                    query: { baseId: base?.id, tableId: table.id },
                  });
                }}
              >
                <span>{table.icon || <Table2 className="size-4 shrink-0" />}</span>
                <span>{table.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={t('common:settings.setting.theme')}>
            <CommandItem
              className="flex gap-2"
              onSelect={() => {
                setOpen(false);
                theme.setTheme('light');
              }}
              value={t('common:settings.setting.light')}
            >
              <Sun className="size-4" />
              <span>{t('common:settings.setting.light')}</span>
            </CommandItem>
            <CommandItem
              className="flex gap-2"
              onSelect={() => {
                setOpen(false);
                theme.setTheme('dark');
              }}
              value={t('common:settings.setting.dark')}
            >
              <Moon className="size-4" />
              <span>{t('common:settings.setting.dark')}</span>
            </CommandItem>
            <CommandItem
              className="flex gap-2"
              onSelect={() => {
                setOpen(false);
                theme.setTheme('system');
              }}
              value={t('common:settings.setting.system')}
            >
              <LaptopIcon className="size-4" />
              <span>{t('common:settings.setting.system')}</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={t('common:settings.title')}>
            <CommandItem
              className="flex gap-2"
              onSelect={() => {
                setOpen(false);
                setting.setOpen(true);
              }}
              value={t('common:settings.title')}
            >
              <Settings className="size-4" />
              <span>{t('common:settings.title')}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
};
