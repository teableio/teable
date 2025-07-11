import { useMutation } from '@tanstack/react-query';
import { hasPermission, getUniqName } from '@teable/core';
import { MoreHorizontal, UserPlus } from '@teable/icons';
import { createBase, getBaseUsage, type IGetSpaceVo } from '@teable/openapi';
import type { ButtonProps } from '@teable/ui-lib';
import { Button, Spin } from '@teable/ui-lib';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { GUIDE_CREATE_BASE } from '@/components/Guide';
import { spaceConfig } from '@/features/i18n/space.config';
import { SpaceActionTrigger } from '../../blocks/space/component/SpaceActionTrigger';
import { UploadPanelDialog } from '../../blocks/space/component/upload-panel';
import { useBaseList } from '../../blocks/space/useBaseList';
import { useIsCloud } from '../../hooks/useIsCloud';
import { useIsEE } from '../../hooks/useIsEE';
import { SpaceCollaboratorModalTrigger } from '../collaborator-manage/space/SpaceCollaboratorModalTrigger';
import { useChatPanelStore } from '../sidebar/useChatPanelStore';

interface ActionBarProps {
  space: IGetSpaceVo;
  invQueryFilters: string[];
  className?: string;
  buttonSize?: ButtonProps['size'];
  disallowSpaceInvitation?: boolean | null;
  onRename?: () => void;
  onDelete?: () => void;
  onSpaceSetting?: () => void;
}

export const SpaceActionBar: React.FC<ActionBarProps> = (props) => {
  const {
    space,
    className,
    buttonSize = 'default',
    disallowSpaceInvitation,
    onRename,
    onDelete,
    onSpaceSetting,
  } = props;
  const [importBaseOpen, setImportBaseOpen] = React.useState(false);

  const { setExpanded } = useChatPanelStore();

  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const router = useRouter();

  const isEE = useIsEE();
  const isCloud = useIsCloud();

  const allBases = useBaseList();
  const bases = allBases?.filter((base) => base.spaceId === space.id);
  const { mutate: getBaseUsageFn } = useMutation({
    mutationFn: getBaseUsage,
    onSuccess: ({ data }) => {
      setExpanded(data?.limit?.chatAIEnable);
    },
  });
  const { mutate: createBaseMutator, isLoading: createBaseLoading } = useMutation({
    mutationFn: createBase,
    onSuccess: ({ data }) => {
      if (isEE || isCloud) {
        getBaseUsageFn(data.id);
      }
      router.push({
        pathname: '/base/[baseId]',
        query: { baseId: data.id },
      });
    },
  });

  return (
    <div className={className}>
      {hasPermission(space.role, 'base|create') && (
        <Button
          className={GUIDE_CREATE_BASE}
          size={buttonSize}
          onClick={() => {
            const name = getUniqName(t('common:noun.base'), bases?.map((base) => base.name) || []);
            createBaseMutator({ spaceId: space.id, name });
          }}
        >
          {t('space:action.createBase')}
          {createBaseLoading && <Spin />}
        </Button>
      )}
      {!disallowSpaceInvitation && (
        <SpaceCollaboratorModalTrigger space={space}>
          <Button variant={'outline'} size={buttonSize}>
            <UserPlus className="size-4" /> {t('space:action.invite')}
          </Button>
        </SpaceCollaboratorModalTrigger>
      )}

      <SpaceActionTrigger
        space={space}
        showRename={hasPermission(space.role, 'space|update')}
        showDelete={hasPermission(space.role, 'space|delete')}
        showSpaceSetting={hasPermission(space.role, 'space|update')}
        showImportBase={hasPermission(space.role, 'space|update')}
        onDelete={onDelete}
        onRename={onRename}
        onSpaceSetting={onSpaceSetting}
        onImportBase={() => setImportBaseOpen(true)}
      >
        <Button variant={'outline'} size={buttonSize}>
          <MoreHorizontal />
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
