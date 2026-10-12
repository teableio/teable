import type { ITemplateVo } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { TemplateTable } from './components';

export const TemplatePage = ({
  renderRequirements,
}: {
  /** What a template needs to run (its integration slots); the EE admin page fills this in. */
  renderRequirements?: (template: ITemplateVo) => React.ReactNode;
}) => {
  const { t } = useTranslation('common');
  return (
    <div className="flex size-full flex-col overflow-auto px-8 py-6">
      <div className="flex items-center justify-between p-2">
        <div className="text-2xl font-semibold">{t('settings.templateAdmin.title')}</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <TemplateTable renderRequirements={renderRequirements} />
      </div>
    </div>
  );
};
