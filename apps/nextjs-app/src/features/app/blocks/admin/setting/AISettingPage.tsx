import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ISettingVo } from '@teable/openapi';
import { getSetting, updateSetting } from '@teable/openapi';
import { useIsHydrated } from '@teable/sdk/hooks';
import { useTranslation } from 'next-i18next';
import { AIConfigFormWizard } from './components/ai-config/AiFormWizard';

export interface IAISettingPageProps {
  settingServerData?: ISettingVo;
}

export const AISettingPage = ({ settingServerData }: IAISettingPageProps) => {
  const { t } = useTranslation('common');
  const isHydrated = useIsHydrated();
  const queryClient = useQueryClient();

  const { data: setting = settingServerData } = useQuery({
    queryKey: ['setting'],
    queryFn: () => getSetting().then(({ data }) => data),
  });

  const { mutate: mutateUpdateSetting } = useMutation({
    mutationFn: (aiConfig: NonNullable<ISettingVo['aiConfig']>) =>
      updateSetting({ aiConfig }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting'] });
    },
  });

  if (!isHydrated || !setting) return null;

  return (
    <div className="flex h-screen flex-1 flex-col overflow-y-auto overflow-x-hidden p-4 sm:p-8">
      <div className="pb-6">
        <h1 className="text-2xl font-semibold">{t('admin.setting.aiSettings')}</h1>
        <div className="mt-2 text-sm text-muted-foreground">
          {t('admin.setting.description')}
        </div>
      </div>

      <AIConfigFormWizard
        aiConfig={setting.aiConfig}
        setAiConfig={mutateUpdateSetting}
        showPricing={false}
      />
    </div>
  );
};
