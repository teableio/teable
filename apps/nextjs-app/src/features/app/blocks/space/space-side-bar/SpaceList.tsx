import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getUniqName, hasPermission } from '@teable/core';
import { Plus, Database, Component } from '@teable/icons';
import { createSpace, createBase, getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin, ConfirmDialog } from '@teable/ui-lib/base';
import {
  Button,
  cn,
  Input,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { type FC, useState, useMemo } from 'react';
import { useSetting } from '@/features/app/hooks/useSetting';
import { SpaceItem } from './SpaceItem';

export const SpaceList: FC = () => {
  const router = useRouter();
  const { disallowSpaceCreation } = useSetting();
  const { t } = useTranslation('common');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [showCreateBaseDialog, setShowCreateBaseDialog] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState('');

  const queryClient = useQueryClient();
  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const { mutate: addSpace, isLoading } = useMutation({
    mutationFn: createSpace,
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      setShowCreateDialog(false);
      setSpaceName('');
      router.push({
        pathname: '/space/[spaceId]',
        query: {
          spaceId: data.data.id,
        },
      });
    },
  });

  const { mutate: addBase, isLoading: isLoadingBase } = useMutation({
    mutationFn: createBase,
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      setShowCreateBaseDialog(false);
      setSelectedSpaceId('');
      router.push({
        pathname: '/base/[baseId]',
        query: {
          baseId: data.data.id,
        },
      });
    },
  });

  // Filter spaces where user has permission to create bases
  const spacesWithBaseCreatePermission = useMemo(() => {
    return spaceList?.filter((space) => hasPermission(space.role, 'base|create')) || [];
  }, [spaceList]);

  const handleCreateSpace = () => {
    const name =
      spaceName.trim() ||
      getUniqName(t('noun.space'), spaceList?.length ? spaceList?.map((space) => space?.name) : []);
    addSpace({ name });
  };

  const handleOpenCreateDialog = () => {
    setShowCreateDialog(true);
    setSpaceName('');
  };

  const handleCreateBase = () => {
    const spaceId = selectedSpaceId;
    const name = getUniqName(t('noun.base'), []);
    addBase({ spaceId, name });
  };

  const handleOpenCreateBaseDialog = () => {
    if (spacesWithBaseCreatePermission.length === 1) {
      // If only one space has permission, use it directly
      const spaceId = spacesWithBaseCreatePermission[0].id;
      const name = getUniqName(t('noun.base'), []);
      addBase({ spaceId, name });
    } else if (spacesWithBaseCreatePermission.length > 1) {
      // Multiple spaces available, show selection dialog
      setShowCreateBaseDialog(true);
      setSelectedSpaceId('');
    }
  };

  return (
    <div className="flex flex-col gap-2 overflow-hidden">
      <div className="px-3">
        {!disallowSpaceCreation && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={'outline'}
                size={'xs'}
                disabled={isLoading || isLoadingBase}
                className={cn('w-full')}
              >
                {isLoading || isLoadingBase ? <Spin className="size-3" /> : <Plus />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {spacesWithBaseCreatePermission.length > 0 ? (
                <DropdownMenuItem onClick={handleOpenCreateBaseDialog}>
                  <Database className="mr-2 size-4" />
                  {t('actions.create')} {t('noun.base')}
                </DropdownMenuItem>
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <DropdownMenuItem disabled className="cursor-not-allowed">
                          <Database className="mr-2 size-4" />
                          {t('actions.create')} {t('noun.base')}
                        </DropdownMenuItem>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t('noPermissionToCreateBase')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleOpenCreateDialog}>
                <Component className="mr-2 size-4" />
                {t('actions.create')} {t('noun.space')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="overflow-y-auto px-3">
        <ul>
          {spaceList?.map((space) => (
            <li key={space.id}>
              <SpaceItem space={space} isActive={space.id === router.query.spaceId} />
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        title={t('actions.create') + ' ' + t('noun.space')}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        confirmLoading={isLoading}
        onCancel={() => {
          setShowCreateDialog(false);
          setSpaceName('');
        }}
        onConfirm={handleCreateSpace}
        content={
          <div className="space-y-2">
            <div className="flex flex-col gap-2">
              <Input
                placeholder={getUniqName(
                  t('noun.space'),
                  spaceList?.length ? spaceList?.map((space) => space?.name) : []
                )}
                value={spaceName}
                onChange={(e) => setSpaceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateSpace();
                  }
                }}
              />
            </div>
          </div>
        }
      />

      <Dialog open={showCreateBaseDialog} onOpenChange={setShowCreateBaseDialog}>
        <DialogContent
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>
              {t('actions.create')} {t('noun.base')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Select {t('noun.space')}</label>
              <Select value={selectedSpaceId} onValueChange={setSelectedSpaceId}>
                <SelectTrigger>
                  <SelectValue placeholder={`Choose a ${t('noun.space').toLowerCase()}...`} />
                </SelectTrigger>
                <SelectContent>
                  {spacesWithBaseCreatePermission.map((space) => (
                    <SelectItem key={space.id} value={space.id}>
                      {space.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              size={'sm'}
              variant={'ghost'}
              onClick={() => {
                setShowCreateBaseDialog(false);
                setSelectedSpaceId('');
              }}
            >
              {t('actions.cancel')}
            </Button>
            <Button
              size={'sm'}
              onClick={handleCreateBase}
              disabled={!selectedSpaceId || isLoadingBase}
            >
              {isLoadingBase && <Spin />}
              {t('actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
