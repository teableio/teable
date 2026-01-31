import { useTranslation } from 'next-i18next';
import { TemplateTable } from './components';

export const TemplatePage = () => {
  const { t } = useTranslation('common');
  return (
    <div className="flex size-full flex-col overflow-auto px-8 py-6">
      <div className="flex items-center justify-between p-2">
        <div className="text-2xl font-semibold">{t('settings.templateAdmin.title')}</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <TemplateTable />
      </div>
    </div>
  );
};
