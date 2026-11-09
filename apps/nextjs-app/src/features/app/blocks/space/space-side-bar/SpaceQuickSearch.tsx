import { Search } from '@teable/icons';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import dynamic from 'next/dynamic';
import { useTranslation } from 'next-i18next';
import { useRef, useState, type FC } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useModKeyStr } from '@/features/app/utils/get-mod-key-str';
import { spaceConfig } from '@/features/i18n/space.config';
// The palette and its search (pinyin matching included) load on first open.
const CommandPalette = dynamic(
  () => import('../../base/base-side-bar/CommandPalette').then((mod) => mod.CommandPalette),
  { ssr: false }
);

interface Props {
  /** The space searched beyond the current project; none where the reader has no space. */
  spaceId?: string;
  onAskAI?: (prompt: string, files?: File[]) => void;
}

export const SpaceQuickSearch: FC<Props> = ({ spaceId, onAskAI }) => {
  const [open, setOpen] = useState(false);
  // Kept mounted once opened, so closing still animates and returns focus.
  const [opened, setOpened] = useState(false);
  if (open && !opened) setOpened(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
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
              className="w-6 shrink-0 px-0"
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
      {opened && (
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          spaceId={spaceId}
          onAskAI={onAskAI}
          triggerRef={triggerRef}
        />
      )}
    </>
  );
};
