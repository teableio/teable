import { useMutation } from '@tanstack/react-query';
import { HttpErrorCode, type HttpError } from '@teable/core';
import type { ISignin, ISignup } from '@teable/openapi';
import {
  signup,
  signin,
  signinSchema,
  signupSchema,
  sendSignupVerificationCode,
  sendSignupVerificationCodeRoSchema,
} from '@teable/openapi';
import { Spin, Error as ErrorCom } from '@teable/ui-lib/base';
import { Button, Input, Label, cn } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ZodIssue } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { authConfig } from '../../i18n/auth.config';
import { useDisallowSignUp } from '../useDisallowSignUp';
import { SendVerificationButton } from './SendVerificationButton';

export interface ISignForm {
  className?: string;
  type?: 'signin' | 'signup';
  onSuccess?: () => void;
}
export const SignForm: FC<ISignForm> = (props) => {
  const { className, type = 'signin', onSuccess } = props;
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const [signupVerificationToken, setSignupVerificationToken] = useState<string>();
  const [signupVerificationCode, setSignupVerificationCode] = useState<string>();
  const router = useRouter();

  const disallowSignUp = useDisallowSignUp();

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setSignupVerificationCode(undefined);
    setSignupVerificationToken(undefined);
    setError(undefined);
  }, [type]);

  const { mutate: submitMutation } = useMutation({
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
    onError: (error: HttpError) => {
      // need verify email
      switch (error.code) {
        case HttpErrorCode.UNPROCESSABLE_ENTITY:
          if (error.data && typeof error.data === 'object' && 'token' in error.data) {
            setSignupVerificationToken(error.data.token as string);
            setError(undefined);
          } else {
            setError(error.message);
          }
          break;
        case HttpErrorCode.CONFLICT:
          setError(t('auth:signError.exist'));
          break;
        case HttpErrorCode.INVALID_CREDENTIALS:
          setError(t('auth:signError.incorrect'));
          break;
        case HttpErrorCode.INVALID_CAPTCHA:
          setError(t('auth:signupError.verificationCodeInvalid'));
          break;
        case HttpErrorCode.TOO_MANY_REQUESTS:
          if (error.data && typeof error.data === 'object' && 'minutes' in error.data) {
            setError(t('auth:signError.tooManyRequests', { minutes: error.data.minutes }));
          } else {
            setError(error.message);
          }
          break;
        default:
          setError(error.message);
      }
      setIsLoading(false);
      return true;
    },
    meta: {
      preventGlobalError: true,
    },
    onSuccess: () => {
      onSuccess?.();
    },
  });

  const {
    mutate: sendSignupVerificationCodeMutation,
    isLoading: sendSignupVerificationCodeLoading,
  } = useMutation({
    mutationFn: (email: string) => sendSignupVerificationCode(email),
    onSuccess: (data) => {
      setSignupVerificationToken(data.data.token);
    },
  });

  const validation = useCallback(
    (form: ISignin | ISignup) => {
      const transformError = (issues: ZodIssue[]) => {
        if (issues?.[0].path?.[0] === 'password') {
          const code = issues[0].code;
          if (code === 'too_small') {
            return { error: t('auth:signupError.passwordLength') };
          }
          if (code === 'invalid_string') {
            return { error: t('auth:signupError.passwordInvalid') };
          }
        }
        return { error: issues[0]?.message ?? t('common:noun.unknownError') };
      };
      if (type === 'signin') {
        const res = signinSchema.safeParse(form);
        if (!res.success) {
          return transformError(res.error.issues);
        }
        return {
          error: undefined,
        };
      }
      const res = signupSchema.safeParse(form);
      if (!res.success) {
        return transformError(res.error.issues);
      }
      return {
        error: undefined,
      };
    },
    [t, type]
  );

  const showVerificationCode = type === 'signup' && signupVerificationToken;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = (event.currentTarget.elements.namedItem('email') as HTMLInputElement).value;
    const password = (event.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
    const code = (event.currentTarget.elements.namedItem('verification-code') as HTMLInputElement)
      ?.value;
    const form = {
      email,
      password,
      verification: code ? { code, token: signupVerificationToken } : undefined,
    };

    const { error } = validation(form);
    if (error) {
      setError(error);
      return;
    }

    if (showVerificationCode && !signupVerificationCode) {
      setError(t('auth:signupError.verificationCodeRequired'));
      return;
    }

    // Using custom isLoading instead of submitMutation.isLoading because isLoading only reflects the mutation state,
    // and we need the loader to persist during the delay between the request completion and the redirect.
    setIsLoading(true);
    submitMutation({ type, form });
  }

  const buttonText = useMemo(
    () => (type === 'signin' ? t('auth:button.signin') : t('auth:button.signup')),
    [t, type]
  );

  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        {
          'pointer-events-none': isLoading,
        },
        className
      )}
    >
      <div className="relative mb-4 text-muted-foreground">
        <h2 className="text-center text-xl">
          {type === 'signin' ? t('auth:title.signin') : t('auth:title.signup')}
        </h2>
      </div>
      <form className="relative" onSubmit={onSubmit} onChange={() => setError(undefined)}>
        <div className="grid gap-3">
          <div className="grid gap-3">
            <Label htmlFor="email">{t('auth:label.email')}</Label>
            <Input
              id="email"
              placeholder={t('auth:placeholder.email')}
              type="text"
              autoComplete="username"
              onChange={() => {
                setSignupVerificationCode(undefined);
                setSignupVerificationToken(undefined);
              }}
              disabled={isLoading}
            />
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t('auth:label.password')}</Label>
            </div>
            <Input
              id="password"
              placeholder={t('auth:placeholder.password')}
              type="password"
              autoComplete={type === 'signup' ? 'new-password' : 'current-password'}
              disabled={isLoading}
            />
            {type === 'signin' && (
              <Link
                className="absolute right-0 text-xs text-muted-foreground underline-offset-4 hover:underline"
                href="/auth/forget-password"
              >
                {t('auth:forgetPassword.trigger')}
              </Link>
            )}
          </div>

          <div
            data-state={showVerificationCode ? 'show' : 'hide'}
            className={cn('transition-all data-[state=show]:mt-4', {
              'h-0 overflow-hidden': !showVerificationCode,
            })}
          >
            {showVerificationCode && (
              <div className="grid gap-3">
                <Label htmlFor="verification-code">{t('auth:label.verificationCode')}</Label>
                <Input
                  id="verification-code"
                  type="text"
                  placeholder={t('auth:placeholder.verificationCode')}
                  value={signupVerificationCode}
                  onChange={(e) => setSignupVerificationCode(e.target.value)}
                />
                <SendVerificationButton
                  disabled={sendSignupVerificationCodeLoading}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const emailInput = e.currentTarget.form?.querySelector(
                      '#email'
                    ) as HTMLInputElement;
                    const email = emailInput?.value;
                    if (!email) {
                      return;
                    }
                    const res = sendSignupVerificationCodeRoSchema.safeParse({ email });
                    if (!res.success) {
                      setError(fromZodError(res.error).message);
                      return;
                    }
                    sendSignupVerificationCodeMutation(email);
                  }}
                  loading={sendSignupVerificationCodeLoading}
                />
              </div>
            )}
          </div>
          <div>
            <Button className="w-full" disabled={isLoading}>
              {isLoading && <Spin />}
              {buttonText}
            </Button>
            {!disallowSignUp && (
              <div className="flex justify-end py-2">
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
            )}
            <ErrorCom error={error} />
          </div>
        </div>
      </form>
    </div>
  );
};
