import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  copyBaseShare,
  createSpace,
  getSpaceList,
  getUserLastVisit,
  LastVisitResourceType,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase } from '@teable/sdk/hooks';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@teable/ui-lib/shadcn';
import { ChevronDown, Loader, Plus } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useShareContext } from '../context/ShareContext';
import { SpaceAvatar } from './space/SpaceAvatar';

export interface IShareSelectSpaceDialogRef {
  setOpen: (open: boolean) => void;
}

export const ShareSelectSpaceDialog = React.forwardRef<IShareSelectSpaceDialogRef, object>(
  (_, ref) => {
    const { t } = useTranslation(['common']);
    const [selectedSpaceId, setSelectedSpaceId] = useState<string>();
    const [baseName, setBaseName] = useState<string>();
    const [newSpaceName, setNewSpaceName] = useState('');
    const router = useRouter();
    const isCopyToSpace = router.query.isCopyToSpace === '1';
    const [open, setOpen] = useState(isCopyToSpace);
    const [copyLoading, setCopyLoading] = useState(false);
    const base = useBase();
    const { shareId } = useShareContext();
    const queryClient = useQueryClient();

    useImperativeHandle(ref, () => ({
      setOpen,
    }));

    const { mutateAsync: copyBaseMutator } = useMutation({
      mutationFn: ({ spaceId, name }: { spaceId: string; name?: string }) => {
        if (!shareId) {
          return Promise.reject(new Error('Share ID is required'));
        }
        return copyBaseShare(shareId, {
          spaceId,
          name,
          withRecords: true,
        });
      },
      onSuccess: ({ data }) => {
        setOpen(false);
        const { id: newBaseId } = data;
        window.location.href = `/base/${newBaseId}`;
      },
      onError: () => {
        setCopyLoading(false);
      },
    });

    const { mutate: createSpaceMutator, isPending: isCreatingSpace } = useMutation({
      mutationFn: (name: string) => createSpace({ name: name || undefined }),
      onSuccess: async (data) => {
        await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
        setSelectedSpaceId(data.data.id);
        setNewSpaceName('');
      },
    });

    const { data: spaceList, isLoading: isLoadingSpaceList } = useQuery({
      queryKey: ReactQueryKeys.spaceList(),
      queryFn: () => getSpaceList().then((data) => data.data),
      enabled: open,
    });
    const { data: userLastVisitSpace, isLoading: isLoadingUserLastVisitSpace } = useQuery({
      queryKey: ['user-last-visit-space', LastVisitResourceType.Space] as const,
      queryFn: () =>
        getUserLastVisit({ resourceType: LastVisitResourceType.Space, parentResourceId: '' }).then(
          (data) => data.data
        ),
      enabled: open,
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

    const hasNoSpaces = !isLoadingSpaceList && spaceList?.length === 0;

    const copyHandler = () => {
      if (!selectedSpaceId) {
        return;
      }
      setCopyLoading(true);
      copyBaseMutator({
        spaceId: selectedSpaceId,
        name: baseName?.trim() || undefined,
      });
    };

    const createSpaceHandler = () => {
      createSpaceMutator(newSpaceName.trim());
    };

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[512px]">
          <DialogHeader>
            <DialogTitle>{t('common:share.copyToSpaceDialog.title')}</DialogTitle>
          </DialogHeader>
          <DialogDescription>{t('common:share.copyToSpaceDialog.description')}</DialogDescription>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>{t('common:share.copyToSpaceDialog.baseName')}</Label>
              <Input
                value={baseName ?? base?.name ?? ''}
                onChange={(e) => setBaseName(e.target.value)}
                disabled={copyLoading}
                placeholder={t('common:share.copyToSpaceDialog.baseNamePlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('common:share.copyToSpaceDialog.selectSpace')}</Label>
              {hasNoSpaces ? (
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-sm">
                    {t('common:share.copyToSpaceDialog.noSpaceDescription')}
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      className="h-9"
                      value={newSpaceName}
                      onChange={(e) => setNewSpaceName(e.target.value)}
                      disabled={isCreatingSpace}
                      placeholder={t('common:share.copyToSpaceDialog.newSpacePlaceholder')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          createSpaceHandler();
                        }
                      }}
                    />
                    <Button
                      onClick={createSpaceHandler}
                      disabled={isCreatingSpace}
                      className="h-9 shrink-0"
                    >
                      {isCreatingSpace ? (
                        <Loader className="size-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="size-4" />
                          {t('common:share.copyToSpaceDialog.createSpace')}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <Select
                  value={selectedSpaceId}
                  onValueChange={setSelectedSpaceId}
                  disabled={copyLoading}
                >
                  <SelectTrigger className="h-9 overflow-hidden [&>svg:last-child]:hidden">
                    <SelectValue />
                    <ChevronDown className="size-4 shrink-0 opacity-50" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[250px]">
                    {spaceList?.map((space) => (
                      <SelectItem key={space.id} value={space.id} className="py-1">
                        <span className="flex w-[400px] items-center gap-2 overflow-x-hidden">
                          <SpaceAvatar name={space.name} className="size-6" />
                          <span className="truncate">{space.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button className="min-w-16" size="sm" variant="outline" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              className="relative min-w-16"
              size="sm"
              onClick={copyHandler}
              disabled={!selectedSpaceId || copyLoading}
            >
              {copyLoading ? (
                <Loader className="size-4 animate-spin " />
              ) : (
                t('common:actions.confirm')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

ShareSelectSpaceDialog.displayName = 'ShareSelectSpaceDialog';
