import { Share2 } from '@teable/icons';
import { useBase } from '@teable/sdk/hooks';
import { Button, Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';
import { PublishBaseDialog } from '../../../blocks/table/table-header/publish-base/PublishBaseDialog';
import { ShareBaseContent } from './ShareBaseContent';

interface IShareBaseDialogProps {
  children?: React.ReactNode;
}

export const ShareBaseDialog = (props: IShareBaseDialogProps) => {
  const { children } = props;
  const base = useBase();
  const [open, setOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const publishTriggerRef = useRef<HTMLButtonElement>(null);
  const onClose = () => setOpen(false);
  const { t } = useTranslation('sdk');

  useEffect(() => {
    if (publishOpen && publishTriggerRef.current) {
      publishTriggerRef.current.click();
      setPublishOpen(false);
    }
  }, [publishOpen]);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          {children ? (
            children
          ) : (
            <Button variant="ghost" size="xs" className="w-full justify-start text-sm font-normal">
              <Share2 className="size-4 shrink-0" />
              <p className="truncate">{t('share.title')}</p>
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] max-w-full overflow-y-auto rounded-xl p-6 md:w-[480px]">
          <div className="overflow-hidden">
            <ShareBaseContent
              baseId={base.id}
              baseName={base.name}
              role={base.role}
              enabledAuthority={base.enabledAuthority}
              onClose={onClose}
              onPublishBase={() => setPublishOpen(true)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <PublishBaseDialog onClose={onClose} closeOnSuccess>
        <button ref={publishTriggerRef} className="hidden" />
      </PublishBaseDialog>
    </>
  );
};
