import { hasPermission } from '@teable/core';
import { MoreHorizontal, UserPlus } from '@teable/icons';
import { type IGetSpaceVo } from '@teable/openapi';
import type { ButtonProps } from '@teable/ui-lib';
import { Button } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { GUIDE_CREATE_BASE } from '@/components/Guide';
import { spaceConfig } from '@/features/i18n/space.config';
import { SpaceActionTrigger } from '../../blocks/space/component/SpaceActionTrigger';
import { UploadPanelDialog } from '../../blocks/space/component/upload-panel';
import { SpaceCollaboratorModalTrigger } from '../collaborator-manage/space/SpaceCollaboratorModalTrigger';
import { CreateBaseModalTrigger } from './CreateBaseModal';

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

  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  return (
    <div className={className}>
      {hasPermission(space.role, 'base|create') && (
        <CreateBaseModalTrigger spaceId={space.id}>
          <Button
            className={GUIDE_CREATE_BASE}
            size={buttonSize}
            // onClick={() => {
            //   const name = getUniqName(
            //     t('common:noun.base'),
            //     bases?.map((base) => base.name) || []
            //   );
            //   createBaseMutator({ spaceId: space.id, name });
            //   close();
            // }}
          >
            {t('space:action.createBase')}
            {/* {createBaseLoading && <Spin />} */}
          </Button>
        </CreateBaseModalTrigger>
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
