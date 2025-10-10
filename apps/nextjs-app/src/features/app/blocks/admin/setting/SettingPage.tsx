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
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef } from 'react';
import { useEnv } from '@/features/app/hooks/useEnv';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { useIsEE } from '@/features/app/hooks/useIsEE';
import { CopyInstance } from './components';
import { Branding } from './components/Branding';
import type { IList } from './components/ConfigurationList';
import { ConfigurationList } from './components/ConfigurationList';
import { MailConfigDialog } from './components/mail-config/MailConfig';
import { InviteCodeManage } from './components/waitlist/InviteCodeManage';
import { WaitlistManage } from './components/waitlist/WaitlistManage';
import { scrollToTarget } from './utils';

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

  const emailRef = useRef<HTMLDivElement>(null);
  const { publicOrigin, publicDatabaseProxy } = useEnv();

  const isHydrated = useIsHydrated();

  const todoLists = useMemo(
    () => [
      {
        title: t('admin.configuration.list.publicOrigin.title'),
        key: 'publicOrigin' as const,
        values: {
          envPublicOrigin: publicOrigin,
          currentPublicOrigin: isHydrated ? location?.origin : '',
        },
        shouldShow: isHydrated ? location?.origin !== publicOrigin : false,
        path: '/admin/setting',
      },
      {
        title: t('admin.configuration.list.https.title'),
        key: 'https' as const,
        shouldShow: isHydrated ? location?.protocol !== 'https:' : false,
        path: '/admin/setting',
      },
      {
        title: t('admin.configuration.list.databaseProxy.title'),
        key: 'databaseProxy' as const,
        shouldShow: !publicDatabaseProxy,
        path: '/admin/setting',
      },
      {
        title: t('admin.configuration.list.llmApi.title'),
        key: 'llmApi' as const,
        shouldShow: !setting?.aiConfig?.enable || setting?.aiConfig?.llmProviders.length === 0,
        path: '/admin/ai-setting?anchor=llm',
      },
      {
        title: t('admin.configuration.list.app.title'),
        key: 'app' as const,
        shouldShow: !setting?.appConfig?.apiKey,
        path: '/admin/ai-setting?anchor=app',
      },
      {
        title: t('admin.configuration.list.webSearch.title'),
        key: 'webSearch' as const,
        shouldShow: !setting?.webSearchConfig?.apiKey,
        path: '/admin/ai-setting?anchor=webSearch',
      },
      {
        title: t('admin.configuration.list.email.title'),
        key: 'email' as const,
        anchor: emailRef,
        shouldShow: !setting?.notifyMailTransportConfig,
        path: '/admin/setting?anchor=email',
      },
    ],
    [
      isHydrated,
      publicDatabaseProxy,
      publicOrigin,
      setting?.aiConfig?.enable,
      setting?.aiConfig?.llmProviders.length,
      setting?.appConfig?.apiKey,
      setting?.webSearchConfig?.apiKey,
      setting?.notifyMailTransportConfig,
      t,
    ]
  );

  const router = useRouter();

  useEffect(() => {
    const { anchor } = router.query;
    if (anchor === 'email') {
      setTimeout(() => {
        emailRef.current && scrollToTarget(emailRef.current);
      }, 500);
    }
  }, [router.query]);

  const finalList = useMemo(() => {
    return todoLists.filter((item) => item.shouldShow);
  }, [todoLists]);

  if (!setting || !isHydrated) return null;

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
    <div className="flex h-screen flex-1 flex-col overflow-y-auto overflow-x-hidden p-4 sm:p-8">
      <div className="pb-6">
        <h1 className="text-2xl font-semibold">{t('admin.setting.instanceTitle')}</h1>
        <div className="mt-2 text-sm text-zinc-500">{t('admin.setting.description')}</div>
      </div>

      <div className="relative flex flex-1 flex-col overflow-hidden sm:flex-row">
        <div className="setting-page-left-container flex-1 overflow-y-auto overflow-x-hidden sm:pr-10">
          {/* General Settings Section */}
          <div className="pb-6">
            <h2 className="mb-4 text-lg font-medium">{t('admin.setting.generalSettings')}</h2>
            <div className="flex w-full flex-col space-y-4">
              <div className="flex items-center justify-between space-x-2 rounded-lg border p-4 shadow-sm">
                <div className="space-y-1">
                  <Label htmlFor="allow-sign-up">{t('admin.setting.allowSignUp')}</Label>
                  <div className="text-xs text-zinc-500">
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
                  <div className="text-xs text-zinc-500">
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
                  <div className="text-xs text-zinc-500">
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
                  <div className="text-xs text-zinc-500">
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
                    <div className="text-xs text-zinc-500">
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

          {/* email config */}
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
        {finalList.length > 0 && <ConfigurationList list={finalList as IList[]} />}
      </div>
    </div>
  );
};
