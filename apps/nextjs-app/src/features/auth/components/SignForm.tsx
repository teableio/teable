import { useMutation } from '@tanstack/react-query';
import { HttpErrorCode, type HttpError } from '@teable/core';
import type { ISignin, ISigninWithCode, ISignup } from '@teable/openapi';
import {
  signup,
  signin,
  signinSchema,
  signupSchema,
  signinWithCode,
  signinWithCodeSchema,
  sendSignupVerificationCode,
  sendSignupVerificationCodeRoSchema,
  sendSigninVerificationCode,
  sendSigninVerificationCodeRoSchema,
} from '@teable/openapi';
import { Spin, Error as ErrorCom } from '@teable/ui-lib/base';
import { Button, Input, Label, cn } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ZodIssue } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { trackSignUp } from '@/components/google-ads';
import { useCutDown } from '@/features/app/hooks/useCutDown';
import { useEnv } from '@/features/app/hooks/useEnv';
import { usePublicSettingQuery } from '@/features/app/hooks/useSetting';
import { authConfig } from '../../i18n/auth.config';
import { useCredentialDraftStore } from '../store/useCredentialDraftStore';
import { PasswordInput } from './PasswordInput';
import { SendVerificationButton } from './SendVerificationButton';
import TurnstileWidget from './TurnstileWidget';

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
  const [inviteCode, setInviteCode] = useState<string>(router.query.inviteCode as string);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>();
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const { countdown, setCountdown } = useCutDown();
  const [turnstileKey, setTurnstileKey] = useState<number>(0);
  // Sign-in only: password (default) or a one-time code mailed to the account.
  const [signinMode, setSigninMode] = useState<'password' | 'code'>('password');
  const [signinCode, setSigninCode] = useState<string>('');
  const [signinCodeSent, setSigninCodeSent] = useState<boolean>(false);
  const env = useEnv();
  const emailRef = useRef<HTMLInputElement>(null);
  const {
    email: draftEmail,
    password: draftPassword,
    setEmail: setDraftEmail,
    setPassword: setDraftPassword,
    clear: clearCredentialDraft,
  } = useCredentialDraftStore();

  const { data: setting } = usePublicSettingQuery();
  const {
    enableWaitlist = false,
    turnstileSiteKey,
    signupVerificationSendCodeMailRate = 0,
    emailCodeSigninEnabled = false,
  } = setting ?? {};
  const isCodeSignin = type === 'signin' && emailCodeSigninEnabled && signinMode === 'code';

  const joinWaitlist = useCallback(() => {
    if (enableWaitlist) {
      const email = emailRef.current?.value;
      const url = email ? `/waitlist?email=${email}` : '/waitlist';
      router.push(url);
    }
  }, [enableWaitlist, router]);

  useEffect(() => {
    setSignupVerificationCode(undefined);
    setSignupVerificationToken(undefined);
    setError(undefined);
    setTurnstileToken(undefined);
    setCountdown(0);
    setSigninMode('password');
    setSigninCode('');
    setSigninCodeSent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Countdown timer for send verification code button

  const { mutate: submitMutation } = useMutation({
    mutationFn: (
      variables:
        | { type: 'signin'; form: ISignin }
        | { type: 'signin-code'; form: ISigninWithCode }
        | { type: 'signup'; form: ISignin }
    ) => {
      const { type, form } = variables;
      if (type === 'signin') {
        return signin(form);
      }
      if (type === 'signin-code') {
        return signinWithCode(form);
      }
      if (type === 'signup') {
        // Affiliate attribution rides the teable_affiliate_via cookie, not this payload.
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
            // Start countdown based on configured rate limit (only if configured)
            if (
              typeof signupVerificationSendCodeMailRate === 'number' &&
              signupVerificationSendCodeMailRate > 0
            ) {
              setCountdown(signupVerificationSendCodeMailRate);
            }
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
      // Reset turnstile token on any error to force re-verification
      setTurnstileToken(undefined);
      setTurnstileKey((prev) => prev + 1);
      setIsLoading(false);
      return true;
    },
    meta: {
      preventGlobalError: true,
    },
    onSuccess: (data, variables) => {
      // Reset turnstile token after successful submission
      setTurnstileToken(undefined);
      setTurnstileKey((prev) => prev + 1);
      clearCredentialDraft();

      // Cross-domain GA4 signup event (Google Ads conversions upload server-side)
      if (variables.type === 'signup' && data.data) {
        trackSignUp({
          marketingGaId: env.marketingGaId,
          userInfo: {
            id: data.data.id,
            email: data.data.email,
            name: data.data.name,
          },
        });
      }

      onSuccess?.();
    },
  });

  const {
    mutate: sendSignupVerificationCodeMutation,
    isPending: sendSignupVerificationCodeLoading,
  } = useMutation({
    mutationFn: ({ email, turnstileToken }: { email: string; turnstileToken?: string }) =>
      sendSignupVerificationCode(email, turnstileToken),
    onSuccess: (data) => {
      setSignupVerificationToken(data.data.token);
      // Start countdown based on configured rate limit (only if configured)
      if (
        typeof signupVerificationSendCodeMailRate === 'number' &&
        signupVerificationSendCodeMailRate > 0
      ) {
        setCountdown(signupVerificationSendCodeMailRate);
      }
      // Reset turnstile token and force widget refresh
      setTurnstileToken(undefined);
      setTurnstileKey((prev) => prev + 1);
    },
    onError: (error: HttpError) => {
      // Reset turnstile on error
      setTurnstileToken(undefined);
      setTurnstileKey((prev) => prev + 1);
      if (
        error.code === HttpErrorCode.TOO_MANY_REQUESTS &&
        error.data &&
        typeof error.data === 'object' &&
        'seconds' in error.data
      ) {
        setError(t('auth:signupError.sendMailRateLimit', { seconds: error.data.seconds }));
        return;
      }
      setError(error.message);
    },
    meta: {
      preventGlobalError: true,
    },
  });

  const { mutate: sendSigninCodeMutation, isPending: sendSigninCodeLoading } = useMutation({
    mutationFn: ({ email, turnstileToken }: { email: string; turnstileToken?: string }) =>
      sendSigninVerificationCode(email, turnstileToken),
    onSuccess: () => {
      setSigninCodeSent(true);
      setError(undefined);
      if (signupVerificationSendCodeMailRate > 0) {
        setCountdown(signupVerificationSendCodeMailRate);
      }
      // The token was consumed by the send-code request; resending needs a fresh one.
      setTurnstileToken(undefined);
      setTurnstileKey((prev) => prev + 1);
    },
    onError: (error: HttpError) => {
      setTurnstileToken(undefined);
      setTurnstileKey((prev) => prev + 1);
      if (
        error.code === HttpErrorCode.TOO_MANY_REQUESTS &&
        error.data &&
        typeof error.data === 'object' &&
        'seconds' in error.data
      ) {
        setError(t('auth:signupError.sendMailRateLimit', { seconds: error.data.seconds }));
        return;
      }
      setError(error.message);
    },
    meta: {
      preventGlobalError: true,
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
          // In Zod 4.x, string validation errors may use different codes
          // Check for common validation failure codes
          if (code === 'invalid_format' || code === 'custom') {
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

  // Turnstile callbacks
  const handleTurnstileVerify = useCallback((token: string) => setTurnstileToken(token), []);
  const handleTurnstileError = useCallback(() => {
    setTurnstileToken(undefined);
    setError(t('auth:signError.turnstileError'));
  }, [t]);
  const handleTurnstileExpire = useCallback(() => {
    setTurnstileToken(undefined);
    setError(t('auth:signError.turnstileExpired'));
  }, [t]);
  const handleTurnstileTimeout = useCallback(() => {
    setTurnstileToken(undefined);
    setError(t('auth:signError.turnstileTimeout'));
  }, [t]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = (event.currentTarget.elements.namedItem('email') as HTMLInputElement).value;

    // Code sign-in: Turnstile is checked when the code is sent, not on submit.
    if (isCodeSignin) {
      if (!signinCode) {
        setError(t('auth:signupError.verificationCodeRequired'));
        return;
      }
      const res = signinWithCodeSchema.safeParse({ email, code: signinCode });
      if (!res.success) {
        setError(res.error.issues[0]?.message ?? t('common:noun.unknownError'));
        return;
      }
      setIsLoading(true);
      submitMutation({ type: 'signin-code', form: res.data });
      return;
    }

    const password = (event.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
    const code = (event.currentTarget.elements.namedItem('verification-code') as HTMLInputElement)
      ?.value;
    const inviteCode = (event.currentTarget.elements.namedItem('invite-code') as HTMLInputElement)
      ?.value;

    const form = {
      email,
      password,
      verification: code ? { code, token: signupVerificationToken } : undefined,
      inviteCode: enableWaitlist ? inviteCode : undefined,
      turnstileToken: turnstileToken,
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

    // Check Turnstile verification if enabled
    if (turnstileSiteKey && !turnstileToken) {
      setError(t('auth:signError.turnstileRequired'));
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
      <div className="relative mb-6 text-muted-foreground">
        <h2 className="text-start text-base">
          {type === 'signin' ? t('auth:title.signin') : t('auth:title.signup')}
        </h2>
      </div>
      <form className="relative" onSubmit={onSubmit} onChange={() => setError(undefined)}>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">{t('auth:label.email')}</Label>
            <Input
              className="h-9 sm:h-8"
              id="email"
              placeholder={t('auth:placeholder.email')}
              type="text"
              autoComplete="username"
              ref={emailRef}
              value={draftEmail}
              onChange={(e) => {
                setDraftEmail(e.target.value);
                setSignupVerificationCode(undefined);
                setSignupVerificationToken(undefined);
                setSigninCodeSent(false);
              }}
              disabled={isLoading}
            />
          </div>
          {isCodeSignin && (
            <div className="grid gap-3">
              <Label htmlFor="verification-code">{t('auth:label.verificationCode')}</Label>
              <Input
                className="h-9 sm:h-8"
                id="verification-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t('auth:placeholder.verificationCode')}
                value={signinCode}
                onChange={(e) => setSigninCode(e.target.value)}
                disabled={isLoading}
              />
              <SendVerificationButton
                label={signinCodeSent ? undefined : t('auth:button.sendCode')}
                disabled={sendSigninCodeLoading || countdown > 0}
                loading={sendSigninCodeLoading}
                countdown={countdown}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (turnstileSiteKey && !turnstileToken) {
                    setError(t('auth:signError.turnstileRequired'));
                    return;
                  }
                  const res = sendSigninVerificationCodeRoSchema.safeParse({
                    email: emailRef.current?.value,
                    turnstileToken,
                  });
                  if (!res.success) {
                    setError(fromZodError(res.error).message);
                    return;
                  }
                  sendSigninCodeMutation(res.data);
                }}
              />
            </div>
          )}
          {!isCodeSignin && (
            <div className="grid gap-2">
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
              <PasswordInput
                className="h-9 sm:h-8"
                id="password"
                placeholder={t('auth:placeholder.password')}
                type="password"
                autoComplete={type === 'signup' ? 'new-password' : 'current-password'}
                value={draftPassword}
                onChange={(e) => setDraftPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>
          )}

          {enableWaitlist && type === 'signup' && (
            <div className="grid gap-3">
              <Label htmlFor="invite-code">{t('common:waitlist.code')}</Label>
              <div className="flex items-center">
                <Input
                  className="h-9 sm:h-8"
                  id="invite-code"
                  type="text"
                  placeholder={t('common:waitlist.inviteCodePlaceholder')}
                  autoComplete="off"
                  disabled={isLoading}
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
                <Button variant="link" className="p-2 text-xs" type="button" onClick={joinWaitlist}>
                  {t('common:waitlist.join')}
                </Button>
              </div>
            </div>
          )}

          {showVerificationCode && (
            <div className="mt-4 grid gap-3">
              <Label htmlFor="verification-code">{t('auth:label.verificationCode')}</Label>
              <Input
                className="h-9 sm:h-8"
                id="verification-code"
                type="text"
                placeholder={t('auth:placeholder.verificationCode')}
                value={signupVerificationCode}
                onChange={(e) => setSignupVerificationCode(e.target.value)}
              />
              <SendVerificationButton
                disabled={sendSignupVerificationCodeLoading || countdown > 0}
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

                  // Check Turnstile verification if enabled
                  if (turnstileSiteKey && !turnstileToken) {
                    setError(t('auth:signError.turnstileRequired'));
                    return;
                  }

                  const res = sendSignupVerificationCodeRoSchema.safeParse({
                    email,
                    turnstileToken,
                  });
                  if (!res.success) {
                    setError(fromZodError(res.error).message);
                    return;
                  }
                  sendSignupVerificationCodeMutation({ email, turnstileToken });
                }}
                loading={sendSignupVerificationCodeLoading}
                countdown={countdown}
              />
            </div>
          )}

          {/* Turnstile Widget */}
          {turnstileSiteKey && (
            <div className="flex justify-center">
              <TurnstileWidget
                key={turnstileKey}
                siteKey={turnstileSiteKey}
                onVerify={handleTurnstileVerify}
                onError={handleTurnstileError}
                onExpire={handleTurnstileExpire}
                onTimeout={handleTurnstileTimeout}
                action={type}
                theme="auto"
                size="normal"
              />
            </div>
          )}

          <div>
            <Button className="w-full" disabled={isLoading}>
              {isLoading && <Spin />}
              {buttonText}
            </Button>
            <ErrorCom error={error} />
            {type === 'signin' && emailCodeSigninEnabled && (
              <Button
                type="button"
                variant="link"
                className="mt-2 h-auto w-full p-0 text-xs text-muted-foreground"
                disabled={isLoading}
                onClick={() => {
                  setSigninMode((mode) => (mode === 'password' ? 'code' : 'password'));
                  setError(undefined);
                }}
              >
                {signinMode === 'password'
                  ? t('auth:button.signinWithCode')
                  : t('auth:button.signinWithPassword')}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
