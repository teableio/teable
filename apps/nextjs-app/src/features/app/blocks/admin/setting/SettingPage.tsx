import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IUpdateSettingRo, ISettingVo } from '@teable/openapi';
import { getSetting, updateSetting } from '@teable/openapi';
import { Label, Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { CopyInstance } from './components';

export interface ISettingPageProps {
  settingServerData?: ISettingVo;
}

export const SettingPage = (props: ISettingPageProps) => {
  const { settingServerData } = props;
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');

  const { data: setting = settingServerData } = useQuery({
    queryKey: ['setting'],
    queryFn: () => getSetting().then(({ data }) => data),
  });

  const { mutateAsync: mutateUpdateSetting } = useMutation({
    mutationFn: (props: IUpdateSettingRo) => updateSetting(props),
    onSuccess: () => {
      queryClient.invalidateQueries(['setting']);
    },
  });

  const onCheckedChange = (key: string, value: boolean) => {
    mutateUpdateSetting({ [key]: value });
  };

  if (!setting) return null;

  const { instanceId, disallowSignUp, disallowSpaceCreation } = setting;

  return (
    <div className="flex h-screen w-full flex-col overflow-y-auto overflow-x-hidden px-8 py-6">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
        <div className="mt-3 text-sm text-slate-500">{t('admin.setting.description')}</div>
      </div>

      <div className="flex w-full flex-col space-y-4 py-4">
        <div className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
          <div className="space-y-1">
            <Label htmlFor="allow-sign-up">{t('admin.setting.allowSignUp')}</Label>
            <div className="text-[13px] text-gray-500">
              {t('admin.setting.allowSignUpDescription')}
            </div>
          </div>
          <Switch
            id="allow-sign-up"
            checked={!disallowSignUp}
            onCheckedChange={(checked) => onCheckedChange('disallowSignUp', !checked)}
          />
        </div>
        <div className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
          <div className="space-y-1">
            <Label htmlFor="allow-space-creation">{t('admin.setting.allowSpaceCreation')}</Label>
            <div className="text-[13px] text-gray-500">
              {t('admin.setting.allowSpaceCreationDescription')}
            </div>
          </div>
          <Switch
            id="allow-space-creation"
            checked={!disallowSpaceCreation}
            onCheckedChange={(checked) => onCheckedChange('disallowSpaceCreation', !checked)}
          />
        </div>
      </div>

      <div className="grow" />

      <CopyInstance instanceId={instanceId} />
    </div>
  );
};
