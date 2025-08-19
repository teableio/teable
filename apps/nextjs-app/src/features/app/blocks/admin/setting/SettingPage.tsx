import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IUpdateSettingRo, ISettingVo } from '@teable/openapi';
import {
  BillingProductLevel,
  getInstanceUsage,
  getSetting,
  SettingKey,
  updateSetting,
} from '@teable/openapi';
import { Label, Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useIsEE } from '@/features/app/hooks/useIsEE';
import { CopyInstance } from './components';
import { AIConfigForm } from './components/ai-config/AiForm';
import { Branding } from './components/Branding';
import { MailConfigDialog } from './components/mail-config/MailConfig';
import { InviteCodeManage } from './components/waitlist/InviteCodeManage';
import { WaitlistManage } from './components/waitlist/WaitlistManage';

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

  const isEE = useIsEE();

  const { data: instanceUsage } = useQuery({
    queryKey: ['instance-usage'],
    queryFn: () => getInstanceUsage().then(({ data }) => data),
    enabled: isEE,
  });

  const onValueChange = (key: string, value: unknown) => {
    mutateUpdateSetting({ [key]: value });
  };

  if (!setting) return null;

  const {
    instanceId,
    disallowSignUp,
    disallowSpaceCreation,
    disallowSpaceInvitation,
    enableEmailVerification,
    enableWaitlist,
    brandName,
    brandLogo,
  } = setting;

  return (
    <div className="flex h-screen w-full flex-col overflow-y-auto overflow-x-hidden px-8 py-6">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
        <div className="mt-3 text-sm text-slate-500">{t('admin.setting.description')}</div>
      </div>

      {/* General Settings Section */}
      <div className="border-b py-4">
        <h2 className="mb-4 text-lg font-medium">{t('admin.setting.generalSettings')}</h2>
        <div className="flex w-full flex-col space-y-4">
          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4 shadow-sm">
            <div className="space-y-1">
              <Label htmlFor="allow-sign-up">{t('admin.setting.allowSignUp')}</Label>
              <div className="text-[13px] text-gray-500">
                {t('admin.setting.allowSignUpDescription')}
              </div>
            </div>
            <Switch
              id="allow-sign-up"
              checked={!disallowSignUp}
              onCheckedChange={(checked) => onValueChange('disallowSignUp', !checked)}
            />
          </div>
          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4 shadow-sm">
            <div className="space-y-1">
              <Label htmlFor="allow-sign-up">{t('admin.setting.allowSpaceInvitation')}</Label>
              <div className="text-[13px] text-gray-500">
                {t('admin.setting.allowSpaceInvitationDescription')}
              </div>
            </div>
            <Switch
              id="allow-space-invitation"
              checked={!disallowSpaceInvitation}
              onCheckedChange={(checked) => onValueChange('disallowSpaceInvitation', !checked)}
            />
          </div>
          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4 shadow-sm">
            <div className="space-y-1">
              <Label htmlFor="allow-space-creation">{t('admin.setting.allowSpaceCreation')}</Label>
              <div className="text-[13px] text-gray-500">
                {t('admin.setting.allowSpaceCreationDescription')}
              </div>
            </div>
            <Switch
              id="allow-space-creation"
              checked={!disallowSpaceCreation}
              onCheckedChange={(checked) => onValueChange('disallowSpaceCreation', !checked)}
            />
          </div>
          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4 shadow-sm">
            <div className="space-y-1">
              <Label htmlFor="enable-email-verification">
                {t('admin.setting.enableEmailVerification')}
              </Label>
              <div className="text-[13px] text-gray-500">
                {t('admin.setting.enableEmailVerificationDescription')}
              </div>
            </div>
            <Switch
              id="enable-email-verification"
              checked={Boolean(enableEmailVerification)}
              onCheckedChange={(checked) => onValueChange('enableEmailVerification', checked)}
            />
          </div>
        </div>
      </div>

      <div className="py-4">
        <h2 className="mb-4 text-lg font-medium">{t('waitlist.title')}</h2>
        <div className="flex flex-col gap-4 rounded-lg border p-4 shadow-sm">
          <div className="flex items-center justify-between ">
            <div className="space-y-1">
              <Label htmlFor="enable-waitlist">{t('admin.setting.enableWaitlist')}</Label>
              <div className="text-[13px] text-gray-500">
                {t('admin.setting.enableWaitlistDescription')}
              </div>
            </div>
            <Switch
              id="enable-waitlist"
              checked={Boolean(enableWaitlist)}
              onCheckedChange={(checked) => onValueChange('enableWaitlist', checked)}
            />
          </div>
          {enableWaitlist && (
            <>
              <div className="flex items-center justify-between ">
                <div className="space-y-1">
                  <Label htmlFor="enable-waitlist">{t('waitlist.title')}</Label>
                </div>
                <WaitlistManage />
              </div>

              <div className="flex items-center justify-between ">
                <div className="space-y-1">
                  <Label htmlFor="enable-waitlist">{t('waitlist.generateCode')}</Label>
                </div>
                <InviteCodeManage />
              </div>
            </>
          )}
        </div>
      </div>

      {/* AI Configuration Section */}
      <div className="py-4">
        <h2 className="mb-4 text-lg font-medium">{t('admin.setting.aiSettings')}</h2>
        <AIConfigForm
          aiConfig={setting.aiConfig}
          setAiConfig={(value) => onValueChange('aiConfig', value)}
        />
      </div>

      <div className="border-b py-4">
        <h2 className="mb-4 text-lg font-medium">{t('email.config')}</h2>
        <div className="flex w-full flex-col space-y-4">
          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4 shadow-sm">
            <div className="space-y-1">
              <Label>{t('email.notify')}</Label>
              <div className="text-[13px] text-gray-500">
                {setting.notifyMailTransportConfig
                  ? setting.notifyMailTransportConfig.host
                  : t('email.customNotifyConfig')}
              </div>
            </div>
            <MailConfigDialog
              name={SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG}
              emailConfig={setting.notifyMailTransportConfig ?? undefined}
            />
          </div>

          {instanceUsage?.limit.automationEnable && (
            <div className="flex items-center justify-between space-x-2 rounded-lg border p-4 shadow-sm">
              <div className="space-y-1">
                <Label>{t('email.automation')}</Label>
                <div className="text-[13px] text-gray-500">
                  {setting.automationMailTransportConfig
                    ? setting.automationMailTransportConfig.host
                    : t('email.customAutomationConfig')}
                </div>
              </div>
              <MailConfigDialog
                name={SettingKey.AUTOMATION_MAIL_TRANSPORT_CONFIG}
                emailConfig={setting.automationMailTransportConfig ?? undefined}
              />
            </div>
          )}
        </div>
      </div>

      {/* Branding Settings Section */}
      {instanceUsage?.level === BillingProductLevel.Enterprise && (
        <Branding
          brandName={brandName}
          brandLogo={brandLogo}
          onChange={(brandName) => onValueChange('brandName', brandName)}
        />
      )}

      <div className="grow" />
      <p className="p-4 text-right text-xs">
        {t('settings.setting.version')}: {process.env.NEXT_PUBLIC_BUILD_VERSION}
      </p>
      <CopyInstance instanceId={instanceId} />
    </div>
  );
};
