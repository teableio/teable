import { MagicAi } from '@teable/icons';
import {
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useChatEnabled } from '../hooks/useChatEnabled';
import { useChatPanelStore } from '../store/useChatPanelStore';

interface ChatTriggerProps {
  buttonClassName?: string;
  children?: React.ReactNode;
}

export const ChatTriggerButton = ({ buttonClassName }: ChatTriggerProps) => {
  const chatEnabled = useChatEnabled();
  const { toggleVisible: toggleChatPanel } = useChatPanelStore();

  return (
    <TooltipWrapper>
      <Button
        variant="ghost"
        size="xs"
        className={cn('flex relative', buttonClassName)}
        onClick={toggleChatPanel}
        disabled={!chatEnabled}
      >
        <MagicAi className="size-4 text-orange-500" />
      </Button>
    </TooltipWrapper>
  );
};

const TooltipWrapper = ({ children }: ChatTriggerProps) => {
  const chatEnabled = useChatEnabled();
  const { t } = useTranslation(['common']);
  if (chatEnabled) return children;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger>{children}</TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>
            <p>{t('common:billing.unavailableInPlanTips')}</p>
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};
