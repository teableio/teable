import { X } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { CreatePluginPanelDialog } from './components/CreatePluginPanelDialog';
import { usePluginPanelStorage } from './hooks/usePluginPanelStorage';

export const PluginPanelEmpty = ({ tableId }: { tableId: string }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { toggleVisible } = usePluginPanelStorage(tableId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[43px] items-center justify-end border-b">
        <Button variant="outline" size="xs" onClick={toggleVisible}>
          <X />
        </Button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <div>{t('table:pluginPanel.empty.description')}</div>
        <CreatePluginPanelDialog tableId={tableId}>
          <Button className="w-fit" size="sm">
            {t('table:pluginPanel.createPluginPanel.button')}
          </Button>
        </CreatePluginPanelDialog>
      </div>
    </div>
  );
};
