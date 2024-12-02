import { useMutation } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import { resetPassword } from '@teable/openapi';
import { passwordSchema } from '@teable/openapi/src/auth/types';
import { Spin, Error } from '@teable/ui-lib/base';
import { Button, Input, Label, Separator, useToast } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { fromZodError } from 'zod-validation-error';
import { authConfig } from '@/features/i18n/auth.config';
import { LayoutMain } from '../components/LayoutMain';

export const ResetPasswordPage = () => {
  const [error, setError] = useState<string>();
  const [password, setPassword] = useState<string>();
  const router = useRouter();
  const code = router.query.code as string;
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const { toast } = useToast();

  const {
    mutateAsync: resetPasswordMutate,
    isLoading,
    isSuccess,
  } = useMutation({
    mutationFn: resetPassword,
    onSuccess: () => {
      toast({
        title: t('auth:resetPassword.success.title'),
        description: t('auth:resetPassword.success.description'),
      });
      setTimeout(() => {
        router.push('/auth/login');
      }, 2000);
    },
  });

  const passwordOnChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setPassword(value);
    setError(undefined);
  };

  const validPassword = (e: React.FocusEvent<HTMLInputElement, Element>) => {
    const value = e.target.value;
    if (!value) {
      return setError(t('auth:resetPassword.error.requiredPassword'));
    }
    const res = passwordSchema.safeParse(value);
    if (!res.success) {
      return setError(fromZodError(res.error).message);
    }
  };

  return (
    <LayoutMain>
      <h1 className="mb-3 text-2xl lg:text-3xl">{t('auth:resetPassword.header')}</h1>
      <p className="mb-10 text-sm text-muted-foreground">{t('auth:resetPassword.description')}</p>
      <div className="flex flex-col gap-2">
        <Label>{t('auth:resetPassword.label')}</Label>
        <div>
          <Input
            id="new-password"
            placeholder={t('auth:placeholder.password')}
            type="password"
            autoComplete="password"
            disabled={isLoading}
            onChange={passwordOnChange}
            onBlur={validPassword}
          />
          <Error error={code ? error : t('auth:resetPassword.error.invalidLink')} />
        </div>
        <Separator className="my-2" />
        <Button
          onClick={async () => {
            if (error || isLoading || !password || isSuccess) return;

            try {
              await resetPasswordMutate({ code, password });
            } catch (err) {
              setError((err as HttpError).message);
            }
          }}
        >
          {isLoading && <Spin />}
          {t('auth:resetPassword.buttonText')}
        </Button>
      </div>
    </LayoutMain>
  );
};
