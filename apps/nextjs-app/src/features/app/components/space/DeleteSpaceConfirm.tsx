import { useQuery } from '@tanstack/react-query';
import { BillingProductLevel, getSpaceUsage } from '@teable/openapi';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogContent,
  DialogTitle,
  Input,
  Label,
} from '@teable/ui-lib/shadcn';
import { Trans, useTranslation } from 'next-i18next';
import React, { useState } from 'react';
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
  const { open, spaceId, spaceName, onOpenChange, onConfirm, onPermanentConfirm } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const isCloud = useIsCloud();
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const { data } = useQuery({
    queryKey: ['usage-before-delete', spaceId],
    queryFn: async () => (await getSpaceUsage(spaceId)).data,
    enabled: isCloud && !!spaceId && open,
  });

  const isBlocked =
    data &&
    data.level !== BillingProductLevel.Free &&
    data.level !== BillingProductLevel.Enterprise;

  const handlePermanentDelete = () => {
    setDeleteConfirmText('');
    setPermanentDeleteConfirm(true);
  };

  const handleConfirmPermanentDelete = () => {
    if (deleteConfirmText !== 'DELETE') {
      return;
    }
    onPermanentConfirm?.();
    onOpenChange(false);
    setPermanentDeleteConfirm(false);
    setDeleteConfirmText('');
  };

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
                <Button variant="destructive" size={'sm'} onClick={handlePermanentDelete}>
                  {t('common:actions.permanentDelete')}
                </Button>
                <Button size={'sm'} onClick={handleAddToTrash}>
                  {t('common:trash.addToTrash')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={permanentDeleteConfirm}
        onOpenChange={(open) => {
          setPermanentDeleteConfirm(open);
          if (!open) {
            setDeleteConfirmText('');
          }
        }}
      >
        <DialogContent
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>
              {t('common:trash.permanentDeleteTips', {
                name: spaceName,
                resource: t('noun.space'),
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-[13px] text-muted-foreground">
              {t('space:deleteSpaceModal.permanentDeleteWarning')}
            </p>
            <div className="space-y-2">
              <Label htmlFor="delete-confirm" className="text-[13px]">
                {t('space:deleteSpaceModal.confirmInputLabel')}
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              size={'sm'}
              variant={'ghost'}
              onClick={() => {
                setPermanentDeleteConfirm(false);
                setDeleteConfirmText('');
              }}
            >
              {t('actions.cancel')}
            </Button>
            <Button
              size={'sm'}
              variant="destructive"
              onClick={handleConfirmPermanentDelete}
              disabled={deleteConfirmText !== 'DELETE'}
            >
              {t('common:actions.permanentDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
