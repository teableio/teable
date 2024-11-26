import { useMutation } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import type { ISignin } from '@teable/openapi';
import { signup, signin, signinSchema, signupSchema } from '@teable/openapi';
import { Spin, Error as ErrorCom } from '@teable/ui-lib/base';
import { Button, Input, Label, cn } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { fromZodError } from 'zod-validation-error';
import { authConfig } from '../../i18n/auth.config';

export interface ISignForm {
  className?: string;
  type?: 'signin' | 'signup';
  onSuccess?: () => void;
}
export const SignForm: FC<ISignForm> = (props) => {
  const { className, type = 'signin', onSuccess } = props;
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const router = useRouter();

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>();
  const submitMutation = useMutation({
    mutationFn: ({ type, form }: { type: 'signin' | 'signup'; form: ISignin }) => {
      if (type === 'signin') {
        return signin(form);
      }
      if (type === 'signup') {
        return signup({
          ...form,
          refMeta: {
            query: window.location.search || undefined,
            referer: document.referrer || undefined,
          },
          defaultSpaceName: t('space:initialSpaceName', { name: form.email.split('@')[0] }),
        });
      }
      throw new Error('Invalid type');
    },
  });

  const validation = useCallback(
    (form: ISignin) => {
      if (type === 'signin') {
        const res = signinSchema.safeParse(form);
        if (!res.success) {
          return { error: fromZodError(res.error).message };
        }
      }
      const res = signupSchema.safeParse(form);
      if (!res.success) {
        return { error: fromZodError(res.error).message };
      }
      return {};
    },
    [type]
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = (event.currentTarget.elements.namedItem('email') as HTMLInputElement).value;
    const password = (event.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
    const form = { email, password };

    const { error } = validation(form);
    if (error) {
      setError(error);
      return;
    }
    try {
      setIsLoading(true);
      await submitMutation.mutateAsync({ type, form });
      onSuccess?.();
    } catch (err) {
      setError((err as HttpError).message);
      setIsLoading(false);
    }
  }

  const buttonText = useMemo(
    () => (type === 'signin' ? t('auth:button.signin') : t('auth:button.signup')),
    [t, type]
  );

  return (
    <div className={cn('grid gap-3', className)}>
      <form className="relative" onSubmit={onSubmit} onChange={() => setError(undefined)}>
        <div className="grid gap-3">
          <div className="grid gap-3">
            <Label htmlFor="email">{t('auth:label.email')}</Label>
            <Input
              id="email"
              placeholder={t('auth:placeholder.email')}
              type="text"
              autoComplete="username"
              disabled={isLoading}
            />
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t('auth:label.password')}</Label>
              {type === 'signin' && (
                <Link
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  href="/auth/forget-password"
                >
                  {t('auth:forgetPassword.trigger')}
                </Link>
              )}
            </div>
            <Input
              id="password"
              placeholder={t('auth:placeholder.password')}
              type="password"
              autoComplete={type === 'signup' ? 'new-password' : 'current-password'}
              disabled={isLoading}
            />
          </div>
          <div>
            <Button className="w-full" disabled={isLoading}>
              {isLoading && <Spin />}
              {buttonText}
            </Button>
            <div className="my-2 flex justify-end">
              <Link
                href={{
                  pathname: type === 'signin' ? '/auth/signup' : '/auth/login',
                  query: { ...router.query },
                }}
                shallow
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {type === 'signin' ? t('auth:button.signup') : t('auth:button.signin')}
              </Link>
            </div>
            <ErrorCom error={error} />
          </div>
        </div>
      </form>
    </div>
  );
};
