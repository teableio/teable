import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IUpdateSettingRo, ISettingVo } from '@teable/openapi';
import {
  BillingProductLevel,
  getInstanceUsage,
  getSetting,
  SettingKey,
  updateSetting,
} from '@teable/openapi';
import { useIsHydrated } from '@teable/sdk/hooks';
import { Label, Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef } from 'react';
import { useEnv } from '@/features/app/hooks/useEnv';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { useIsEE } from '@/features/app/hooks/useIsEE';
import { CopyInstance } from './components';
import { AIConfigForm } from './components/ai-config/AiForm';
import { Branding } from './components/Branding';
import { ConfigurationList } from './components/ConfigurationList';
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
  const isCloud = useIsCloud();

  const { data: instanceUsage } = useQuery({
    queryKey: ['instance-usage'],
    queryFn: () => getInstanceUsage().then(({ data }) => data),
    enabled: isEE,
  });

  const onValueChange = (key: string, value: unknown) => {
    mutateUpdateSetting({ [key]: value });
  };

  const llmRef = useRef<HTMLDivElement>(null);
  // const v0Ref = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLDivElement>(null);
  const { publicOrigin, publicDatabaseProxy } = useEnv();

  const isHydrated = useIsHydrated();

  const todoLists = useMemo(
    () => [
      {
        title: t('admin.configuration.list.publicOrigin.title'),
        key: 'publicOrigin' as const,
        shouldShow: isHydrated ? location?.origin !== publicOrigin : false,
      },
      {
        title: t('admin.configuration.list.https.title'),
        key: 'https' as const,
        shouldShow: isHydrated ? location?.protocol !== 'https:' : false,
      },
      {
        title: t('admin.configuration.list.databaseProxy.title'),
        key: 'databaseProxy' as const,
        shouldShow: !publicDatabaseProxy,
      },
      {
        title: t('admin.configuration.list.llmApi.title'),
        key: 'llmApi' as const,
        anchor: llmRef,
        shouldShow: !setting?.aiConfig?.enable || setting?.aiConfig?.llmProviders.length === 0,
      },
      // {
      //   title: t('admin.configuration.list.v0.title'),
      //   key: 'v0' as const,
      //   anchor: v0Ref,
      // },
      {
        title: t('admin.configuration.list.email.title'),
        key: 'email' as const,
        anchor: emailRef,
        shouldShow: !setting?.notifyMailTransportConfig,
      },
    ],
    [
      isHydrated,
      publicDatabaseProxy,
      publicOrigin,
      setting?.aiConfig?.enable,
      setting?.aiConfig?.llmProviders.length,
      setting?.notifyMailTransportConfig,
      t,
    ]
  );

  const finalList = useMemo(() => {
    return todoLists.filter((item) => item.shouldShow);
  }, [todoLists]);

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
    <div className="flex h-screen flex-1 flex-col overflow-y-auto overflow-x-hidden p-8">
      <div className="pb-6">
        <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
        <div className="mt-2 text-sm text-slate-500">{t('admin.setting.description')}</div>
      </div>

      <div className="relative flex flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mr-10 flex-1 overflow-y-auto overflow-x-hidden">
          {/* General Settings Section */}
          <div className="pb-6">
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
                  <Label htmlFor="allow-space-creation">
                    {t('admin.setting.allowSpaceCreation')}
                  </Label>
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

          {isCloud && (
            <div className="pb-6">
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
          )}

          {/* AI Configuration Section */}
          <div className="pb-6" ref={llmRef}>
            <h2 className="mb-4 text-lg font-medium">{t('admin.setting.aiSettings')}</h2>
            <AIConfigForm
              aiConfig={setting.aiConfig}
              setAiConfig={(value) => onValueChange('aiConfig', value)}
            />
          </div>

          <div className="pb-6" ref={emailRef}>
            <h2 className="mb-4 text-lg font-medium">{t('email.config')}</h2>
            <div className="flex w-full flex-col space-y-4">
              <div className="flex items-center justify-between space-x-2 rounded-lg border p-4 shadow-sm">
                <div className="space-y-1">
                  <Label>{t('email.notify')}</Label>
                  <div className="text-xs text-zinc-500">
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
                    <div className="text-xs text-zinc-500">
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
            {!setting.notifyMailTransportConfig && (
              <div className="pt-2 text-xs text-red-500">
                {t('admin.configuration.list.email.errorTips')}
              </div>
            )}
          </div>

          {/* Branding Settings Section */}
          {instanceUsage?.level === BillingProductLevel.Enterprise && (
            <Branding
              brandName={brandName}
              brandLogo={brandLogo}
              onChange={(brandName) => onValueChange('brandName', brandName)}
            />
          )}

          <CopyInstance instanceId={instanceId} />
        </div>
        {finalList.length > 0 && <ConfigurationList list={finalList} />}
      </div>
    </div>
  );
};
