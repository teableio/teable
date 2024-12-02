import { useMutation } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import { sendResetPasswordEmail } from '@teable/openapi';
import { Spin, Error } from '@teable/ui-lib/base';
import { Button, Input, Label, Separator, useToast } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { z } from 'zod';
import { authConfig } from '@/features/i18n/auth.config';
import { LayoutMain } from '../components/LayoutMain';

export const ForgetPasswordPage = () => {
  const [error, setError] = useState<string>();
  const [email, setEmail] = useState<string>();
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const { toast } = useToast();

  const { mutateAsync: sendResetPasswordEmailMutate, isLoading } = useMutation({
    mutationFn: sendResetPasswordEmail,
    onSuccess: () => {
      toast({
        title: t('auth:forgetPassword.success.title'),
        description: t('auth:forgetPassword.success.description'),
      });
    },
  });

  const emailOnChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setEmail(value);
    setError('');
  };

  const validEmail = (e: React.FocusEvent<HTMLInputElement, Element>) => {
    const value = e.target.value;
    if (!value) {
      return setError(t('auth:forgetPassword.errorRequiredEmail'));
    }
    if (!z.string().email().safeParse(value).success) {
      return setError(t('auth:forgetPassword.errorInvalidEmail'));
    }
  };

  return (
    <LayoutMain>
      <h1 className="mb-3 text-2xl lg:text-3xl">{t('auth:forgetPassword.header')}</h1>
      <p className="mb-16 text-sm text-muted-foreground">{t('auth:forgetPassword.description')}</p>
      <div className="flex flex-col gap-2">
        <Label>{t('auth:label.email')}</Label>
        <div>
          <Input
            id="email"
            placeholder={t('auth:placeholder.email')}
            type="text"
            autoComplete="email"
            disabled={isLoading}
            onChange={emailOnChange}
            onBlur={validEmail}
          />
          <Error error={error} />
        </div>
        <Separator className="my-2" />
        <Button
          onClick={async () => {
            if (error || isLoading || !email) return;
            try {
              await sendResetPasswordEmailMutate({ email });
            } catch (err) {
              setError((err as HttpError).message);
            }
          }}
        >
          {isLoading && <Spin />}
          {t('auth:forgetPassword.buttonText')}
        </Button>
      </div>
    </LayoutMain>
  );
};
