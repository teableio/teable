import { Search } from '@teable/icons';
import { useBaseId } from '@teable/sdk/hooks';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  Button,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useModKeyStr } from '@/features/app/utils/get-mod-key-str';
import { tableConfig } from '@/features/i18n/table.config';
import { useBaseNodeContext } from '../base-node/hooks/useBaseNodeContext';
import { PaletteExtras, ProjectNodeGroups } from './PaletteGroups';

export const QuickAction = () => {
  const baseId = useBaseId() as string;
  const [open, setOpen] = useState(false);
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

  const { treeItems } = useBaseNodeContext();

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
          <ProjectNodeGroups
            baseId={baseId}
            treeItems={treeItems}
            onNavigate={() => setOpen(false)}
          />
          <PaletteExtras onClose={() => setOpen(false)} />
        </CommandList>
      </CommandDialog>
    </>
  );
};
