import { useQuery } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { Selector } from '@/components/Selector';
import { spaceConfig } from '@/features/i18n/space.config';
import { useSpaceSubscriptionStore } from './useSpaceSubscriptionStore';

export const SpaceSubscriptionModal = () => {
  const { subscribeLevel, closeModal } = useSpaceSubscriptionStore();
  const [targetSpaceId, setTargetSpaceId] = useState<string>();
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const ownerSpaceList = useMemo(() => {
    return spaceList?.filter((space) => hasPermission(space.role, 'space|update')) || [];
  }, [spaceList]);

  useEffect(() => {
    if (!targetSpaceId) {
      setTargetSpaceId(ownerSpaceList[0]?.id);
    }
  }, [ownerSpaceList, targetSpaceId]);

  const onSubmit = () => {
    if (!targetSpaceId) {
      toast.error(t('space:baseModal.missTargetTip'));
      return;
    }

    closeModal();
    router.push({
      pathname: '/space/[spaceId]/setting/plan',
      query: { spaceId: targetSpaceId, subscribeLevel: subscribeLevel },
    });
  };

  return (
    <Dialog open={Boolean(subscribeLevel)} onOpenChange={(isOpen) => !isOpen && closeModal()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="flex flex-col gap-y-2">
          <DialogTitle>{t('billing.spaceSubscriptionModal.title')}</DialogTitle>
          <DialogDescription>{t('billing.spaceSubscriptionModal.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-4">
            <Label htmlFor="username" className="text-right">
              {t('space:baseModal.toSpace')}
            </Label>
            <Selector
              className="min-w-40"
              candidates={ownerSpaceList}
              selectedId={targetSpaceId}
              onChange={(id) => setTargetSpaceId(id)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="sm" type="button" variant="ghost">
              {t('common:actions.cancel')}
            </Button>
          </DialogClose>
          <Button size="sm" type="submit" onClick={() => onSubmit()}>
            {t('common:actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
