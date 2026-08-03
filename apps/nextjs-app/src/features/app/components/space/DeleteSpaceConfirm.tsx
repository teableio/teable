import { useQuery } from '@tanstack/react-query';
import { BillingProductLevel, getSpaceUsage } from '@teable/openapi';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogContent,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { Trans, useTranslation } from 'next-i18next';
import React from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { useIsCloud } from '../../hooks/useIsCloud';

export interface IDeleteSpaceConfirmProps {
  open: boolean;
  spaceId: string;
  spaceName?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm?: () => void;
  onPermanentConfirm?: () => void;
}

export const DeleteSpaceConfirm: React.FC<IDeleteSpaceConfirmProps> = (props) => {
  const { open, spaceId, spaceName, onOpenChange, onConfirm } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const isCloud = useIsCloud();

  const { data } = useQuery({
    queryKey: ['usage-before-delete', spaceId],
    queryFn: async () => (await getSpaceUsage(spaceId)).data,
    enabled: isCloud && !!spaceId && open,
  });

  const isBlocked =
    data &&
    data.level !== BillingProductLevel.Free &&
    data.level !== BillingProductLevel.Enterprise;

  const handleAddToTrash = () => {
    onConfirm?.();
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>
              {isBlocked ? (
                t('space:deleteSpaceModal.blockedTitle')
              ) : (
                <Trans ns="space" i18nKey={'tip.delete'}>
                  {spaceName}
                </Trans>
              )}
            </DialogTitle>
          </DialogHeader>
          {isBlocked ? (
            <div className="text-sm">{t('space:deleteSpaceModal.blockedDesc')}</div>
          ) : (
            <div className="py-1" />
          )}
          <DialogFooter>
            {isBlocked ? (
              <Button size={'sm'} onClick={() => onOpenChange(false)}>
                {t('actions.confirm')}
              </Button>
            ) : (
              <>
                <Button size={'sm'} variant={'ghost'} onClick={() => onOpenChange(false)}>
                  {t('actions.cancel')}
                </Button>
                <Button size={'sm'} onClick={handleAddToTrash}>
                  {t('common:trash.addToTrash')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
