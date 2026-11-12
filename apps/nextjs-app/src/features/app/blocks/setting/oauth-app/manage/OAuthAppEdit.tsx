import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Key, Plus } from '@teable/icons';
import type { GenerateOAuthSecretVo, OAuthUpdateRo } from '@teable/openapi';
import { deleteOAuthSecret, generateOAuthSecret, oauthGet, oauthUpdate } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Badge, Button, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';
import {
  SettingEmpty,
  SettingItem,
  SettingListItem,
  SettingSection,
} from '@/features/app/components/setting/SettingSection';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';
import type { IOAuthAppFormRef } from './OAuthAppForm';
import { OAuthAppForm } from './OAuthAppForm';
import { OAuthFormLayout } from './OAuthFormLayout';

interface IOAuthAppEditProps {
  onBack: () => void;
  clientId: string;
}

export const OAuthAppEdit = (props: IOAuthAppEditProps) => {
  const { onBack, clientId } = props;
  const formRef = useRef<IOAuthAppFormRef>(null);
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  const dayjs = useLanDayjs();
  const queryClient = useQueryClient();
  const [updatedForm, setUpdatedForm] = useState<OAuthUpdateRo>();
  const [newSecret, setNewSecret] = useState<GenerateOAuthSecretVo>();

  const { data: oauthApp, isLoading: queryLoading } = useQuery({
    queryKey: ReactQueryKeys.oauthApp(clientId),
    queryFn: ({ queryKey }) => oauthGet(queryKey[1]).then((data) => data.data),
    gcTime: 0,
  });

  const { mutate: updateMutate, isPending: isLoading } = useMutation({
    mutationFn: (ro: OAuthUpdateRo) => oauthUpdate(clientId, ro),
    onSuccess: () => {
      onBack();
    },
  });

  const { mutate: generateSecretMutate, isPending: generateSecretLoading } = useMutation({
    mutationFn: generateOAuthSecret,
    onSuccess: (res) => {
      setNewSecret(res.data);
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.oauthApp(clientId) });
    },
  });

  const { mutate: deleteSecretMutate } = useMutation({
    mutationFn: (secretId: string) => deleteOAuthSecret(clientId, secretId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.oauthApp(clientId) });
    },
  });

  return (
    <OAuthFormLayout
      onCancel={onBack}
      loading={isLoading}
      onSubmit={() => {
        if (!updatedForm) {
          return onBack();
        }
        updatedForm && formRef.current?.validate() && updateMutate(updatedForm);
      }}
    >
      <SettingSection title={t('oauth:formType.clientInfo')}>
        <SettingItem
          label={t('oauth:form.clientId.label').replace(/[:：]\s*$/, '')}
          description={t('oauth:form.clientId.description')}
          action={
            oauthApp?.clientId && (
              <>
                <span className="font-mono text-sm">{oauthApp.clientId}</span>
                <CopyButton variant="ghost" size="icon-sm" text={oauthApp.clientId} />
              </>
            )
          }
        />
      </SettingSection>
      <SettingSection
        variant="list"
        title={t('oauth:form.secret.label')}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={generateSecretLoading}
            onClick={() => generateSecretMutate(clientId)}
          >
            {generateSecretLoading ? <Spin /> : <Plus className="size-4 shrink-0" />}
            {t('oauth:form.secret.add')}
          </Button>
        }
        bare={!oauthApp?.secrets?.length}
      >
        {!oauthApp?.secrets?.length ? (
          <SettingEmpty icon={<Key />}>{t('oauth:form.secret.empty')}</SettingEmpty>
        ) : (
          oauthApp.secrets.map((secret) => {
            const isNewSecret = newSecret?.id === secret.id;
            return (
              <SettingListItem
                key={secret.id}
                className={cn(isNewSecret && 'bg-green-300/20 dark:bg-green-700/20')}
                icon={<Key />}
                title={
                  <>
                    <span className="break-all font-mono">
                      {isNewSecret ? newSecret?.secret : secret.secret}
                    </span>
                    {isNewSecret && (
                      <CopyButton variant="ghost" size="icon-xs" text={newSecret.secret} />
                    )}
                    <Badge variant="outline">{t('oauth:form.secret.tag')}</Badge>
                  </>
                }
                description={
                  isNewSecret ? (
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="size-4 shrink-0 text-warning" />
                      {t('oauth:form.secret.newDescription')}
                    </span>
                  ) : undefined
                }
                meta={
                  secret.lastUsedTime
                    ? t('oauth:form.secret.lastUsed', {
                        date: dayjs(secret.lastUsedTime).fromNow(),
                      })
                    : t('oauth:form.secret.neverUsed')
                }
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteSecretMutate(secret.id)}
                  >
                    {t('common:actions.delete')}
                  </Button>
                }
              />
            );
          })
        )}
      </SettingSection>
      {!queryLoading && <OAuthAppForm ref={formRef} value={oauthApp} onChange={setUpdatedForm} />}
    </OAuthFormLayout>
  );
};
