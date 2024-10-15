import { useMutation } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import type { IViewInstallPluginRo } from '@teable/openapi';
import { installViewPlugin, PluginPosition } from '@teable/openapi';
import { useTableId } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef } from 'react';
import type { IPluginCenterDialogRef } from '@/features/app/components/plugin/PluginCenterDialog';
import { PluginCenterDialog } from '@/features/app/components/plugin/PluginCenterDialog';
import { tableConfig } from '@/features/i18n/table.config';
import { VIEW_ICON_MAP } from '../../view/constant';

const PluginViewIcon = VIEW_ICON_MAP[ViewType.Plugin];

interface IAddPluginViewProps {
  onClose: () => void;
}

export const AddPluginView = (props: IAddPluginViewProps) => {
  const tableId = useTableId()!;
  const { onClose } = props;
  const router = useRouter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const ref = useRef<IPluginCenterDialogRef>(null);
  const { mutate: installViewPluginMutate } = useMutation({
    mutationFn: (ro: IViewInstallPluginRo) => installViewPlugin(tableId, ro),
    onSuccess: (res) => {
      ref.current?.close();
      const { viewId } = res.data;
      const { baseId } = router.query;
      router.push(
        {
          pathname: '/base/[baseId]/[tableId]/[viewId]',
          query: { baseId, tableId, viewId },
        },
        undefined,
        { shallow: Boolean(router.query.viewId) }
      );
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
