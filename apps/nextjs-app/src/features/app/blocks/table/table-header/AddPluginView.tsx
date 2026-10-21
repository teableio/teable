import { useMutation } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import { type IViewInstallPluginRo } from '@teable/openapi';
import { installViewPlugin, PluginPosition } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useRef } from 'react';
import type { IPluginCenterDialogRef } from '@/features/app/components/plugin/PluginCenterDialog';
import { PluginCenterDialog } from '@/features/app/components/plugin/PluginCenterDialog';
import type { IBaseResourceTable } from '@/features/app/hooks/useBaseResource';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { useNavigateToView } from '@/features/app/hooks/useResourceNavigation';
import { tableConfig } from '@/features/i18n/table.config';
import { VIEW_ICON_MAP } from '../../view/constant';

const PluginViewIcon = VIEW_ICON_MAP[ViewType.Plugin];

interface IAddPluginViewProps {
  onClose: () => void;
}

export const AddPluginView = (props: IAddPluginViewProps) => {
  const { onClose } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const ref = useRef<IPluginCenterDialogRef>(null);
  const { tableId } = useBaseResource() as IBaseResourceTable;
  const navigateToView = useNavigateToView();
  const { mutate: installViewPluginMutate } = useMutation({
    mutationFn: (ro: IViewInstallPluginRo) => installViewPlugin(tableId, ro),
    onSuccess: (res) => {
      ref.current?.close();
      navigateToView(tableId, res.data.viewId);
    },
  });
  return (
    <PluginCenterDialog
      positionType={PluginPosition.View}
      onInstall={(id, name) => {
        installViewPluginMutate({
          pluginId: id,
          name,
        });
        onClose();
      }}
    >
      <Button variant={'ghost'} size={'xs'} className="w-full justify-start font-normal">
        <PluginViewIcon className="pe-1 text-lg" />
        {t('table:view.addPluginView')}
      </Button>
    </PluginCenterDialog>
  );
};
