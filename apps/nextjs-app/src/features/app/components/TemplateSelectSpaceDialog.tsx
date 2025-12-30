import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createBaseFromTemplate,
  getSpaceList,
  getUserLastVisit,
  LastVisitResourceType,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@teable/ui-lib/shadcn';
import { Loader } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { SpaceAvatar } from './space/SpaceAvatar';

export interface ITemplateSelectSpaceDialogRef {
  setOpen: (open: boolean) => void;
}

interface ITemplateSelectSpaceDialogProps {
  templateId: string;
}

export const TemplateSelectSpaceDialog = React.forwardRef<
  ITemplateSelectSpaceDialogRef,
  ITemplateSelectSpaceDialogProps
>(({ templateId }, ref) => {
  const { t } = useTranslation(['common']);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>();
  const router = useRouter();
  const isUseTemplate = router.query.isUseTemplate === '1';
  const [open, setOpen] = useState(isUseTemplate);
  const [applyTemplateLoading, setApplyTemplateLoading] = useState(false);

  useImperativeHandle(ref, () => ({
    setOpen,
  }));

  const { mutateAsync: applyTemplateMutator } = useMutation({
    mutationFn: ({ spaceId, templateId }: { spaceId: string; templateId: string }) =>
      createBaseFromTemplate({ spaceId, templateId, withRecords: true }),
    onSuccess: ({ data }) => {
      setOpen(false);
      const { id: baseId, defaultUrl } = data;

      // If defaultUrl is provided, navigate to it directly (e.g., to a default node)
      if (defaultUrl) {
        window.location.href = defaultUrl;
        return;
      }

      // Otherwise, navigate to base home
      window.location.href = `/base/${baseId}`;
    },
    onError: () => {
      setApplyTemplateLoading(false);
    },
  });

  const { data: spaceList, isLoading: isLoadingSpaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });
  const { data: userLastVisitSpace, isLoading: isLoadingUserLastVisitSpace } = useQuery({
    queryKey: ['user-last-visit-space', LastVisitResourceType.Space] as const,
    queryFn: () =>
      getUserLastVisit({ resourceType: LastVisitResourceType.Space, parentResourceId: '' }).then(
        (data) => data.data
      ),
  });
  const defaultSpaceId = useMemo(() => {
    if (isLoadingUserLastVisitSpace || isLoadingSpaceList) {
      return;
    }
    if (!userLastVisitSpace) {
      return spaceList?.[0]?.id;
    }
    if (spaceList?.some((space) => space.id === userLastVisitSpace.resourceId)) {
      return userLastVisitSpace.resourceId;
    }
  }, [userLastVisitSpace, spaceList, isLoadingUserLastVisitSpace, isLoadingSpaceList]);

  useEffect(() => {
    if (defaultSpaceId) {
      setSelectedSpaceId(defaultSpaceId);
    }
  }, [defaultSpaceId]);

  const useTemplateHandler = () => {
    if (!selectedSpaceId) {
      return;
    }
    setApplyTemplateLoading(true);
    applyTemplateMutator({ spaceId: selectedSpaceId, templateId });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[512px]">
        <DialogHeader>
          <DialogTitle>{t('common:template.useTemplateDialog.title')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>{t('common:template.useTemplateDialog.description')}</DialogDescription>
        <Select
          value={selectedSpaceId}
          onValueChange={setSelectedSpaceId}
          disabled={applyTemplateLoading}
        >
          <SelectTrigger className="h-11 overflow-x-hidden">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="h-[250px]">
            {spaceList?.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                <span className="flex w-[400px] items-center gap-2 overflow-x-hidden">
                  <SpaceAvatar name={space.name} className="size-8" />
                  <span className="truncate">{space.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button className="min-w-16" size="sm" variant="outline" onClick={() => setOpen(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            className="relative min-w-16"
            size="sm"
            onClick={useTemplateHandler}
            disabled={!selectedSpaceId || applyTemplateLoading}
          >
            {applyTemplateLoading ? (
              <Loader className="size-4 animate-spin " />
            ) : (
              t('common:actions.confirm')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

TemplateSelectSpaceDialog.displayName = 'TemplateSelectSpaceDialog';
