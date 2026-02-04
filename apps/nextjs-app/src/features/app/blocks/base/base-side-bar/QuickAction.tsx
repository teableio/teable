import { LaptopIcon } from '@radix-ui/react-icons';
import { Moon, Search, Settings, Sun } from '@teable/icons';
import { useTheme } from '@teable/next-themes';
import { BaseNodeResourceType } from '@teable/openapi';
import { useBaseId, useIsAnonymous, useIsTemplate } from '@teable/sdk/hooks';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  Button,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@teable/ui-lib/shadcn';
import { groupBy } from 'lodash';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { useSettingStore } from '@/features/app/components/setting/useSettingStore';
import { useModKeyStr } from '@/features/app/utils/get-mod-key-str';
import { tableConfig } from '@/features/i18n/table.config';
import { BaseNodeResourceIconMap, getNodeIcon, getNodeName, getNodeUrl } from '../base-node/hooks';
import { useBaseNodeContext } from '../base-node/hooks/useBaseNodeContext';

export const QuickAction = () => {
  const baseId = useBaseId() as string;
  const [open, setOpen] = useState(false);
  const setting = useSettingStore();
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const isAnonymous = useIsAnonymous();
  const isTemplate = useIsTemplate();
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

  const { treeItems } = useBaseNodeContext();
  const baseNodeTypeItems = groupBy(
    Object.values(treeItems).filter((item) => item.resourceType !== BaseNodeResourceType.Folder),
    'resourceType'
  );

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="size-7 shrink-0 p-0"
              variant="ghost"
              size="xs"
              onClick={() => setOpen(true)}
            >
              <Search className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent hideWhenDetached={true}>
            {t('common:quickAction.title')}
            <span>{modKeyStr}+K</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <CommandDialog
        closeable={false}
        open={open}
        onOpenChange={setOpen}
        commandProps={{
          filter: (value, search, keywords) => {
            const searchLower = search.toLowerCase();
            if (keywords?.some((keyword) => keyword.toLowerCase().includes(searchLower))) {
              return 1;
            }
            return 0;
          },
        }}
      >
        <CommandInput placeholder={t('common:quickAction.placeHolder')} />
        <CommandList>
          <CommandEmpty>{t('common:noResult')}</CommandEmpty>
          {Object.entries(baseNodeTypeItems).map(([resourceType, items]) => {
            const heading = () => {
              switch (resourceType) {
                case BaseNodeResourceType.Table:
                  return t('common:noun.table');
                case BaseNodeResourceType.Dashboard:
                  return t('common:noun.dashboard');
                case BaseNodeResourceType.App:
                  return t('common:noun.app');
                case BaseNodeResourceType.Workflow:
                  return t('common:noun.automation');
                default:
                  return '';
              }
            };
            return (
              <CommandGroup heading={heading()} key={resourceType}>
                {items.map((item) => {
                  const { id, resourceType, resourceId } = item;
                  const name = getNodeName(item);
                  const icon = getNodeIcon(item);
                  const IconComponent = BaseNodeResourceIconMap[resourceType];
                  const url = getNodeUrl({
                    baseId,
                    resourceType,
                    resourceId,
                  });
                  return (
                    <CommandItem
                      className="flex h-8 gap-2"
                      key={id}
                      value={id}
                      keywords={[name]}
                      onSelect={() => {
                        setOpen(false);
                        if (url) {
                          router.push(url);
                        }
                      }}
                    >
                      <div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                        {icon ? (
                          <Emoji emoji={icon} size="1em" />
                        ) : IconComponent ? (
                          <IconComponent className="size-full" />
                        ) : null}
                      </div>
                      <span>{name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            );
          })}
          <CommandSeparator />
          <CommandGroup heading={t('common:settings.setting.theme')}>
            <CommandItem
              className="flex h-8 gap-2"
              onSelect={() => {
                setOpen(false);
                theme.setTheme('light');
              }}
              value={t('common:settings.setting.light')}
              keywords={[t('common:settings.setting.light')]}
            >
              <div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                <Sun className="size-full" />
              </div>
              <span>{t('common:settings.setting.light')}</span>
            </CommandItem>
            <CommandItem
              className="flex h-8 gap-2"
              onSelect={() => {
                setOpen(false);
                theme.setTheme('dark');
              }}
              value={t('common:settings.setting.dark')}
              keywords={[t('common:settings.setting.dark')]}
            >
              <div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                <Moon className="size-full" />
              </div>
              <span>{t('common:settings.setting.dark')}</span>
            </CommandItem>
            <CommandItem
              className="flex h-8 gap-2"
              onSelect={() => {
                setOpen(false);
                theme.setTheme('system');
              }}
              value={t('common:settings.setting.system')}
              keywords={[t('common:settings.setting.system')]}
            >
              <div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                <LaptopIcon className="size-full" />
              </div>
              <span>{t('common:settings.setting.system')}</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          {!isAnonymous && !isTemplate && (
            <CommandGroup heading={t('common:settings.nav.settings')}>
              <CommandItem
                className="flex h-8 gap-2"
                onSelect={() => {
                  setOpen(false);
                  setting.setOpen(true);
                }}
                value={t('common:settings.personal.title')}
                keywords={[t('common:settings.personal.title')]}
              >
                <div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                  <Settings className="size-full" />
                </div>
                <span>{t('common:settings.personal.title')}</span>
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
};
