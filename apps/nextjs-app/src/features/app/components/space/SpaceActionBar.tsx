import { useMutation } from '@tanstack/react-query';
import { getUniqName, hasPermission } from '@teable/core';
import { MoreHorizontal, Plus, UserPlus } from '@teable/icons';
import { createBase, type IGetSpaceVo } from '@teable/openapi';
import { useIsMobile } from '@teable/sdk/hooks';
import type { ButtonProps } from '@teable/ui-lib';
import { Button, cn } from '@teable/ui-lib';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn/ui/tooltip';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useMemo } from 'react';
import { GUIDE_CREATE_BASE } from '@/components/Guide';
import { spaceConfig } from '@/features/i18n/space.config';
import { SpaceActionTrigger } from '../../blocks/space/component/SpaceActionTrigger';
import { UploadPanelDialog } from '../../blocks/space/component/upload-panel';
import { useBaseList } from '../../blocks/space/useBaseList';
import { InviteSpacePopover } from '../collaborator/space/InviteSpacePopover';

interface ActionBarProps {
  space: IGetSpaceVo;
  invQueryFilters: string[];
  className?: string;
  buttonSize?: ButtonProps['size'];
  disallowSpaceInvitation?: boolean | null;
  onRename?: () => void;
  onDelete?: () => void;
  onPermanentDelete?: () => void;
}

export const SpaceActionBar: React.FC<ActionBarProps> = (props) => {
  const {
    space,
    className,
    buttonSize = 'default',
    disallowSpaceInvitation,
    onRename,
    onDelete,
    onPermanentDelete,
  } = props;
  const [importBaseOpen, setImportBaseOpen] = React.useState(false);

  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const isMobile = useIsMobile();
  const router = useRouter();
  const bases = useBaseList();

  const basesInSpace = useMemo(() => {
    return bases?.filter((base) => base.spaceId === space.id);
  }, [bases, space.id]);

  const { mutate: createBaseMutator, isPending: createBaseLoading } = useMutation({
    mutationFn: createBase,
    onSuccess: ({ data }) => {
      router.push({
        pathname: '/base/[baseId]',
        query: { baseId: data.id },
      });
    },
  });

  const handleCreateBase = () => {
    const name = getUniqName(t('common:noun.base'), basesInSpace?.map((base) => base.name) || []);
    createBaseMutator({ spaceId: space.id, name });
  };

  const canCreateBase = hasPermission(space.role, 'base|create');

  return (
    <div className={cn('flex shrink-0 items-center gap-2', className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {isMobile ? (
              <Button
                variant={'outline'}
                size="icon"
                className="size-7"
                onClick={handleCreateBase}
                disabled={!canCreateBase || createBaseLoading}
              >
                <Plus className="size-4" />
              </Button>
            ) : (
              <Button
                className={GUIDE_CREATE_BASE}
                size={buttonSize}
                onClick={handleCreateBase}
                disabled={!canCreateBase || createBaseLoading}
              >
                <Plus className="size-4" />
                {t('space:action.createBase')}
              </Button>
            )}
          </TooltipTrigger>
          {!canCreateBase && (
            <TooltipContent>{t('space:tooltip.noPermissionToCreateBase')}</TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      {!disallowSpaceInvitation && (
        <InviteSpacePopover space={space}>
          {isMobile ? (
            <Button variant={'outline'} size="icon" className="size-7">
              <UserPlus className="size-4" />
            </Button>
          ) : (
            <Button variant={'outline'} size={buttonSize}>
              <UserPlus className="size-4" /> {t('space:action.invite')}
            </Button>
          )}
        </InviteSpacePopover>
      )}

      <SpaceActionTrigger
        space={space}
        showRename={false}
        showSettings={hasPermission(space.role, 'space|update')}
        showDelete={hasPermission(space.role, 'space|delete')}
        showImportBase={hasPermission(space.role, 'space|update')}
        onDelete={onDelete}
        onPermanentDelete={onPermanentDelete}
        onRename={onRename}
        onImportBase={() => setImportBaseOpen(true)}
      >
        <Button variant={'outline'} size={buttonSize} className="p-[5px]">
          <MoreHorizontal className="size-4" />
        </Button>
      </SpaceActionTrigger>

      <UploadPanelDialog
        spaceId={space.id}
        open={importBaseOpen}
        onOpenChange={setImportBaseOpen}
      />
    </div>
  );
};
