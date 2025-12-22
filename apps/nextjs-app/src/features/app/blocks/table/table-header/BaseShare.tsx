import { Button } from '@teable/ui-lib/shadcn';
import { ChevronRight, Send } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { PublishBaseDialog } from './publish-base/PublishBaseDialog';

export const BaseShare = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation(['table', 'common', 'space']);
  return (
    <PublishBaseDialog onClose={onClose} closeOnSuccess={false}>
      <Button
        variant="outline"
        className="flex h-10 w-full items-center gap-2 bg-muted px-3 py-[10px]"
      >
        <div className="flex-start flex flex-1 items-center gap-2">
          <Send className="size-4" />
          {t('space:publishBase.publishToCommunity')}
        </div>

        <ChevronRight className="size-4 shrink-0" />
      </Button>
    </PublishBaseDialog>
  );
};
