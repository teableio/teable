import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTemplate } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { TemplateTable } from './components';

export const TemplatePage = () => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const { mutate: createTemplateFn } = useMutation({
    mutationFn: createTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.templateList());
    },
  });
  return (
    <div className="flex size-full flex-col overflow-auto px-8 py-6">
      <div className="flex items-center justify-between p-2">
        <div className="text-2xl font-semibold">{t('settings.templateAdmin.title')}</div>
        <Button variant="outline" onClick={() => createTemplateFn({})}>
          {t('settings.templateAdmin.baseSelectPanel.createTemplate')}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <TemplateTable />
      </div>
    </div>
  );
};
