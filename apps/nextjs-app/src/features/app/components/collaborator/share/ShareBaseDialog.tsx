import { UserPlus } from '@teable/icons';
import type { IGetBaseVo } from '@teable/openapi';
import { useBase } from '@teable/sdk/hooks';
import { Button, cn, Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';
import { PublishBaseDialog } from '../../../blocks/table/table-header/publish-base/PublishBaseDialog';
import { ShareBaseContent } from './ShareBaseContent';

interface IBaseInviteDialogProps {
  base: IGetBaseVo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
}

export const BaseInviteDialog = ({
  base,
  open,
  onOpenChange,
  children,
}: IBaseInviteDialogProps) => {
  const [isSubPage, setIsSubPage] = useState(false);
  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
    if (!open) setIsSubPage(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent
        className={cn(
          'max-h-[90vh] max-w-full overflow-y-auto rounded-xl md:w-[480px]',
          isSubPage ? 'p-6' : 'px-7 pb-3'
        )}
      >
        <ShareBaseContent
          baseId={base.id}
          spaceId={base.spaceId}
          baseName={base.name}
          role={base.role}
          enabledAuthority={base.enabledAuthority}
          onClose={() => handleOpenChange(false)}
          onSubPageChange={setIsSubPage}
        />
      </DialogContent>
    </Dialog>
  );
};

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
  const { t } = useTranslation('space');

  useEffect(() => {
    if (publishOpen && publishTriggerRef.current) {
      publishTriggerRef.current.click();
      setPublishOpen(false);
    }
  }, [publishOpen]);

  return (
    <>
      <BaseInviteDialog base={base} open={open} onOpenChange={setOpen}>
        {children ?? (
          <Button
            variant="ghost"
            size="xs"
            data-attr="base-sidebar-invite"
            className="w-full justify-start text-sm font-normal"
          >
            <UserPlus className="size-4 shrink-0" />
            <p className="truncate">{t('action.invite')}</p>
          </Button>
        )}
      </BaseInviteDialog>

      <PublishBaseDialog onClose={onClose} closeOnSuccess>
        <button ref={publishTriggerRef} className="hidden" />
      </PublishBaseDialog>
    </>
  );
};
