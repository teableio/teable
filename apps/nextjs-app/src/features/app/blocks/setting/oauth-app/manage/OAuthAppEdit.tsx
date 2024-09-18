import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Key } from '@teable/icons';
import type { GenerateOAuthSecretVo, OAuthUpdateRo } from '@teable/openapi';
import { deleteOAuthSecret, generateOAuthSecret, oauthGet, oauthUpdate } from '@teable/openapi';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Badge, Button, Separator, cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';
import { FormPageLayout } from '../../components/FormPageLayout';
import type { IOAuthAppFormRef } from './OAuthAppForm';
import { OAuthAppForm } from './OAuthAppForm';

interface IOAuthAppEditProps {
  onBack: () => void;
}

export const OAuthAppEdit = (props: IOAuthAppEditProps) => {
  const { onBack } = props;
  const router = useRouter();
  const formRef = useRef<IOAuthAppFormRef>(null);
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  const dayjs = useLanDayjs();
  const queryClient = useQueryClient();
  const clientId = router.query.id as string;
  const [updatedForm, setUpdatedForm] = useState<OAuthUpdateRo>();
  const [newSecret, setNewSecret] = useState<GenerateOAuthSecretVo>();

  const { data: oauthApp, isLoading: queryLoading } = useQuery({
    queryKey: ['oauthApp', clientId],
    queryFn: ({ queryKey }) => oauthGet(queryKey[1]).then((data) => data.data),
    cacheTime: 0,
  });

  const { mutate: updateMutate, isLoading } = useMutation({
    mutationFn: (ro: OAuthUpdateRo) => oauthUpdate(clientId, ro),
    onSuccess: () => {
      onBack();
    },
  });

  const { mutate: generateSecretMutate, isLoading: generateSecretLoading } = useMutation({
    mutationFn: generateOAuthSecret,
    onSuccess: (res) => {
      setNewSecret(res.data);
      queryClient.invalidateQueries(['oauthApp', clientId]);
    },
  });

  const { mutate: deleteSecretMutate } = useMutation({
    mutationFn: (secretId: string) => deleteOAuthSecret(clientId, secretId),
    onSuccess: () => {
      queryClient.invalidateQueries(['oauthApp', clientId]);
    },
  });

  return (
    <FormPageLayout
      onCancel={onBack}
      loading={isLoading}
      onSubmit={() => {
        if (!updatedForm) {
          return onBack();
        }
        updatedForm && formRef.current?.validate() && updateMutate(updatedForm);
      }}
    >
      <div>
        <div className="space-y-2">
          <div className="space-y-1">
            <h3 className="font-semibold">{t('oauth:formType.clientInfo')}</h3>
            <Separator />
          </div>
          <div className="text-sm">
            <strong>{t('oauth:form.clientId.label')}</strong>
            {oauthApp?.clientId}
          </div>
        </div>
        <div className="space-y-4 pt-10">
          <div className="flex items-center justify-between">
            <strong>{t('oauth:form.secret.label')}</strong>
            <Button
              variant={'outline'}
              size={'xs'}
              disabled={generateSecretLoading}
              onClick={() => generateSecretMutate(clientId)}
            >
              {generateSecretLoading && <Spin />}
              {t('oauth:form.secret.add')}
            </Button>
          </div>
          {!oauthApp?.secrets?.length && (
            <div className="text-sm">{t('oauth:form.secret.empty')}</div>
          )}
          <div className="rounded-lg border">
            {oauthApp?.secrets?.map((secret, index) => {
              const isNewSecret = newSecret?.id === secret.id;
              return (
                <div
                  key={secret.id}
                  className={cn('flex items-center gap-4 p-4', {
                    'bg-green-300/20 p-3 text-sm dark:bg-green-700/20': isNewSecret,
                    'border-t': index !== 0,
                  })}
                >
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div>
                      <Key className="size-8" />
                    </div>
                    <Badge variant="outline">{t('oauth:form.secret.tag')}</Badge>
                  </div>
                  <div className="flex-1 text-xs">
                    <div
                      className={cn({
                        'flex items-center gap-2': isNewSecret,
                      })}
                    >
                      {isNewSecret && <Check className="text-green-400 dark:text-green-600" />}
                      {isNewSecret ? newSecret?.secret : secret.secret}
                      {isNewSecret && (
                        <CopyButton className="h-6 p-0" variant={'link'} text={newSecret.secret} />
                      )}
                    </div>
                    {isNewSecret && (
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="text-warning" />
                        {t('oauth:form.secret.newDescription')}
                      </div>
                    )}
                    <div className="text-muted-foreground">
                      {secret.lastUsedTime
                        ? t('oauth:form.secret.lastUsed', {
                            date: dayjs(secret.lastUsedTime).fromNow(),
                          })
                        : t('oauth:form.secret.neverUsed')}
                    </div>
                  </div>
                  <Button
                    size={'xs'}
                    variant={'destructive'}
                    onClick={() => deleteSecretMutate(secret.id)}
                  >
                    {t('common:actions.delete')}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {!queryLoading && (
        <OAuthAppForm ref={formRef} showBasicTitle value={oauthApp} onChange={setUpdatedForm} />
      )}
    </FormPageLayout>
  );
};
