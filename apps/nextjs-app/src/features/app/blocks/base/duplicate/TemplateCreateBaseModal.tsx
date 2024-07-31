import { useMutation, useQuery } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { createBaseFromTemplate, getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Switch,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { Selector } from '@/components/Selector';
import { spaceConfig } from '@/features/i18n/space.config';
import { useTemplateCreateBaseStore } from './useTemplateCreateBaseStore';

const TemplateBase = ({ templateId }: { templateId: string }) => {
  const { closeModal } = useTemplateCreateBaseStore();
  const [withRecords, setWithRecords] = useState(true);
  const [targetSpaceId, setTargetSpaceId] = useState<string>();
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const { mutateAsync: templateCreateBaseMutator } = useMutation({
    mutationFn: createBaseFromTemplate,
    onSuccess: ({ data }) => {
      closeModal();
      router.push({
        pathname: '/base/[baseId]',
        query: { baseId: data.id },
      });
    },
  });

  const editableSpaceList = useMemo(() => {
    return spaceList?.filter((space) => hasPermission(space.role, 'base|create')) || [];
  }, [spaceList]);

  useEffect(() => {
    if (!targetSpaceId) {
      setTargetSpaceId(editableSpaceList[0]?.id);
    }
  }, [editableSpaceList, targetSpaceId, templateId]);

  const onSubmit = () => {
    if (!targetSpaceId) {
      toast.error(t('space:baseModal.missTargetTip'));
      return;
    }

    toast.message(t('space:baseModal.copyingTemplate'));

    templateCreateBaseMutator({
      templateId,
      spaceId: targetSpaceId,
      withRecords,
    });
  };

  return (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>{t('space:baseModal.createBaseFromTemplate')}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-4">
          <Label htmlFor="duplicate-records-mode">{t('space:baseModal.duplicateRecords')}</Label>
          <Switch
            id="duplicate-records-mode"
            checked={withRecords}
            onCheckedChange={(v) => setWithRecords(v)}
          />
        </div>
        <div className="flex items-center gap-4">
          <Label htmlFor="username" className="text-right">
            {t('space:baseModal.toSpace')}
          </Label>
          <Selector
            className="min-w-40"
            candidates={editableSpaceList}
            selectedId={targetSpaceId}
            onChange={(id) => setTargetSpaceId(id)}
          />
        </div>
      </div>
      <DialogFooter className="mt-4">
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
  );
};

export const TemplateCreateBaseModal = () => {
  const { templateId, closeModal } = useTemplateCreateBaseStore();
  return (
    <Dialog open={Boolean(templateId)} onOpenChange={(isOpen) => !isOpen && closeModal()}>
      {templateId && <TemplateBase templateId={templateId} />}
    </Dialog>
  );
};
