import { useMutation } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import { BaseNodeResourceType, type IViewInstallPluginRo } from '@teable/openapi';
import { installViewPlugin, PluginPosition } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef } from 'react';
import type { IPluginCenterDialogRef } from '@/features/app/components/plugin/PluginCenterDialog';
import { PluginCenterDialog } from '@/features/app/components/plugin/PluginCenterDialog';
import type { IBaseResourceTable } from '@/features/app/hooks/useBaseResource';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { tableConfig } from '@/features/i18n/table.config';
import { getNodeUrl } from '../../base/base-node/hooks';
import { VIEW_ICON_MAP } from '../../view/constant';

const PluginViewIcon = VIEW_ICON_MAP[ViewType.Plugin];

interface IAddPluginViewProps {
  onClose: () => void;
}

export const AddPluginView = (props: IAddPluginViewProps) => {
  const { onClose } = props;
  const router = useRouter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const ref = useRef<IPluginCenterDialogRef>(null);
  const { baseId, tableId } = useBaseResource() as IBaseResourceTable;
  const { mutate: installViewPluginMutate } = useMutation({
    mutationFn: (ro: IViewInstallPluginRo) => installViewPlugin(tableId, ro),
    onSuccess: (res) => {
      ref.current?.close();
      const { viewId } = res.data;
      const url = getNodeUrl({
        baseId,
        resourceType: BaseNodeResourceType.Table,
        resourceId: tableId,
        viewId,
      });
      if (url) {
        router.push(url, undefined, { shallow: true });
      }
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
        <PluginViewIcon className="pr-1 text-lg" />
        {t('table:view.addPluginView')}
      </Button>
    </PluginCenterDialog>
  );
};
