import { useMutation, useQuery } from '@tanstack/react-query';
import { HttpError } from '@teable/core';
import { AlertTriangle, HelpCircle } from '@teable/icons';
import { deviceAppGet, deviceDecision } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button, Card, Input } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { OAuthScope } from '@/features/app/components/oauth/OAuthScope';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { isSafeWebUrl } from '@/features/app/utils/is-safe-web-url';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';

/**
 * The server distinguishes already-decided (400), an app whose owner turned
 * the device flow off (403), and expired or never issued (404 and the rest).
 */
function errorMessageKey(error: unknown) {
  if (error instanceof HttpError && error.status === 400) {
    return 'oauth:device.codeUsed' as const;
  }
  if (error instanceof HttpError && error.status === 403) {
    return 'oauth:device.deviceFlowDisabled' as const;
  }
  return 'oauth:device.invalidCode' as const;
}

/** Same shape the server hands out: two groups of four letters. */
function formatUserCode(value: string): string {
  const compact = value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 8);
  return compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

/**
 * Approval page of the device authorization grant: a CLI that cannot receive a
 * browser redirect shows a user code, and the person types it here to hand that
 * CLI their permissions.
 */
export const OAuthDevicePage = () => {
  const { user } = useSession();
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  const getPreviewUrl = usePreviewUrl();

  const [input, setInput] = useState('');
  // Only set once the user commits a code — typing must not fire a lookup per
  // keystroke, and a wrong code has to report itself rather than silently retry.
  const [userCode, setUserCode] = useState('');
  // Part of the query key so resubmitting the *same* code retries the lookup:
  // with `retry: false` an errored query would otherwise sit on its stale
  // error and the button would appear to do nothing.
  const [attempt, setAttempt] = useState(0);
  const [decided, setDecided] = useState<'approved' | 'denied'>();

  const { data: app, error } = useQuery({
    queryKey: ['oauth-device-app', userCode, attempt],
    queryFn: ({ queryKey }) => deviceAppGet(queryKey[1] as string).then((res) => res.data),
    enabled: Boolean(userCode) && !decided,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { mutate: decide, isPending } = useMutation({
    mutationFn: (approve: boolean) => deviceDecision({ userCode, approve }),
    onSuccess: (_data, approve) => setDecided(approve ? 'approved' : 'denied'),
    // The code can go stale while this page is open — decided elsewhere,
    // expired, or the app's owner turned the flow off. Silence here would
    // leave a button that appears to do nothing.
    onError: (mutationError) => toast.error(t(errorMessageKey(mutationError))),
  });

  /**
   * A device code is the one thing on this page an attacker wants: talk someone
   * into typing theirs and they get a session as that person. It gets the
   * weight of a callout, not a footnote.
   */
  const securityNotice = (
    <div className="rounded-lg border border-amber-400/70 bg-amber-50 p-4 dark:border-amber-700/60 dark:bg-amber-950/30">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-500">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="text-sm font-medium">{t('oauth:device.securityTitle')}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('oauth:device.phishingHint')}</p>
      <p className="mt-2 text-xs font-medium">{t('oauth:device.phishingHintStrong')}</p>
    </div>
  );

  // Not flex-centered: with `items-center` an overflowing card gets its top
  // clipped and cannot be scrolled back to. The container scrolls instead, and
  // `my-8` keeps the card centred while it still fits.
  const shell = (children: React.ReactNode) => (
    <div className="h-screen w-full overflow-auto px-4">
      <Card className="mx-auto my-8 w-full min-w-72 max-w-xl space-y-4 p-8">
        <TeableLogo className="size-8" />
        {children}
      </Card>
    </div>
  );

  if (decided) {
    return shell(
      <>
        <h2 className="text-xl font-semibold">
          {t(decided === 'approved' ? 'oauth:device.approvedTitle' : 'oauth:device.deniedTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            decided === 'approved'
              ? 'oauth:device.approvedDescription'
              : 'oauth:device.deniedDescription'
          )}
        </p>
      </>
    );
  }

  if (!userCode || error) {
    return shell(
      <>
        <h2 className="text-center text-xl font-semibold">{t('oauth:device.title')}</h2>
        <p className="text-center text-sm text-muted-foreground">{t('oauth:device.description')}</p>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setUserCode(input);
            setAttempt((n) => n + 1);
          }}
        >
          <Input
            value={input}
            onChange={(event) => setInput(formatUserCode(event.target.value))}
            placeholder="XXXX-XXXX"
            className="h-12 text-center font-mono text-lg uppercase tracking-[0.4em]"
          />
          {error && (
            <p className="text-center text-sm text-destructive">{t(errorMessageKey(error))}</p>
          )}
          {securityNotice}
          <Button type="submit" className="w-full" disabled={input.replace('-', '').length < 8}>
            {t('oauth:device.submit')}
          </Button>
        </form>
      </>
    );
  }

  if (!app) {
    return shell(
      <div className="flex justify-center py-8">
        <Spin />
      </div>
    );
  }

  // Order is the point here: who is asking, which code, the warning — all of it
  // above the fold — and only then the (long) scope list, boxed so it cannot
  // push the buttons past the bottom of the screen.
  return shell(
    <>
      <div className="relative mx-auto size-16 overflow-hidden">
        {app.logo ? (
          <img
            src={getPreviewUrl(app.logo)}
            alt={app.name}
            className="absolute inset-0 size-full object-contain"
          />
        ) : (
          <HelpCircle className="size-16" />
        )}
      </div>
      <h2 className="text-center text-xl font-semibold">
        {t('oauth:decision.title', { name: app.name })}
      </h2>
      {/* The registered homepage is how a person tells the real app from an
          impostor using its name — same signal the decision page shows. Only
          http(s) gets to be a link; a javascript:/data: homepage renders as
          inert text. */}
      <div className="text-center">
        {isSafeWebUrl(app.homepage) ? (
          <a
            href={app.homepage}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {app.homepage}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">{app.homepage}</span>
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <UserAvatar user={user} />
        <span className="text-sm text-muted-foreground">@{user?.name}</span>
      </div>

      <div className="rounded-lg border bg-muted/40 p-4 text-center">
        <div className="text-xs text-muted-foreground">{t('oauth:device.codeLabel')}</div>
        <div className="mt-1 font-mono text-2xl font-semibold tracking-[0.3em]">{userCode}</div>
        <div className="mt-1 text-xs text-muted-foreground">{t('oauth:device.confirmCode')}</div>
      </div>

      {securityNotice}

      <div className="space-y-2">
        <div className="text-sm font-medium">{t('oauth:decision.scopes')}</div>
        <div className="max-h-56 overflow-y-auto rounded-lg border p-4">
          <OAuthScope scopes={app.scopes} className="px-0" />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          className="flex-1"
          disabled={isPending}
          onClick={() => decide(false)}
        >
          {t('common:actions.cancel')}
        </Button>
        <Button className="flex-1" disabled={isPending} onClick={() => decide(true)}>
          {t('oauth:decision.authorize')}
        </Button>
      </div>
    </>
  );
};
