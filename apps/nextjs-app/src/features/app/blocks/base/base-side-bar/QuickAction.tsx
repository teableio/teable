import { Search } from '@teable/icons';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useModKeyStr } from '@/features/app/utils/get-mod-key-str';
import { tableConfig } from '@/features/i18n/table.config';
import { CommandPalette } from './CommandPalette';

export interface QuickActionProps {
  onAskAI?: (prompt: string, files?: File[]) => void;
}

export const QuickAction = ({ onAskAI }: QuickActionProps) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const modKeyStr = useModKeyStr();

  useHotkeys(
    'mod+k',
    () => {
      setOpen((value) => !value);
    },
    {
      enableOnFormTags: ['input', 'select', 'textarea'],
      enableOnContentEditable: true,
      preventDefault: true,
    }
  );

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={triggerRef}
              aria-label={t('common:commandPalette.title')}
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
            <span className="ms-2">{modKeyStr}+K</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        onAskAI={onAskAI}
        triggerRef={triggerRef}
      />
    </>
  );
};
