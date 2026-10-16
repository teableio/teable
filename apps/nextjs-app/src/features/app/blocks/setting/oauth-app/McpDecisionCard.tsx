import { AlertTriangle, Check } from '@teable/icons';
import type { DecisionInfoGetVo } from '@teable/openapi';
import { Button, Card, Checkbox, Label } from '@teable/ui-lib/shadcn';
import { Trans, useTranslation } from 'next-i18next';
import { useState } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { OAuthLogo } from '@/features/app/components/oauth/OAuthLogo';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';

/**
 * Consent card for a client that registered itself (RFC 7591), i.e. an MCP
 * client such as Claude Code. There is no developer, homepage or logo to show
 * and the scope set is fixed, so instead of a scope matrix the card says in
 * plain words what the client will be able to do, and makes the person
 * confirm the redirect target: whoever owns that address gets the code, and
 * registration is anonymous, so the person is the only one who can vouch for
 * it.
 */
export const McpDecisionCard = ({
  transactionId,
  decisionInfo,
}: {
  transactionId: string;
  decisionInfo: DecisionInfoGetVo;
}) => {
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  const [trusted, setTrusted] = useState(false);
  const name = decisionInfo.name;
  const abilities = ['ability1', 'ability2', 'ability3'] as const;

  return (
    <Card className="w-full max-w-[520px] px-10 py-9">
      <div className="flex flex-col items-center gap-5 text-center">
        {/* The two parties being connected. */}
        <div className="flex items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-xl border bg-background">
            <TeableLogo className="size-8" />
          </div>
          <span className="h-px w-6 bg-border" />
          <div className="flex size-14 items-center justify-center rounded-xl border bg-background">
            <OAuthLogo name={name} dynamicRegistration className="size-8" />
          </div>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{t('oauth:mcpDecision.title')}</h1>
          <p className="text-sm text-muted-foreground">
            <Trans
              ns="oauth"
              i18nKey="mcpDecision.subtitle"
              values={{ name }}
              components={{ b: <b className="font-medium text-foreground" /> }}
            />
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-2.5">
        <p className="text-sm text-muted-foreground">
          <Trans
            ns="oauth"
            i18nKey="mcpDecision.capabilities"
            values={{ name }}
            components={{ b: <b className="font-medium text-foreground" /> }}
          />
        </p>
        <ul className="divide-y rounded-lg border">
          {abilities.map((key) => (
            <li key={key} className="flex items-start gap-3 px-4 py-3 text-sm leading-5">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{t(`oauth:mcpDecision.${key}`)}</span>
            </li>
          ))}
        </ul>
      </div>

      {decisionInfo.redirectUri && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 space-y-1">
              <p>{t('oauth:mcpDecision.redirectTitle')}</p>
              <p className="break-all font-mono text-xs font-medium leading-5">
                {decisionInfo.redirectUri}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 ps-[26px]">
            <Checkbox
              id="mcp-trust-redirect"
              checked={trusted}
              onCheckedChange={(value) => setTrusted(value === true)}
            />
            <Label htmlFor="mcp-trust-redirect" className="cursor-pointer text-sm font-normal">
              {t('oauth:mcpDecision.trustRedirect')}
            </Label>
          </div>
        </div>
      )}

      <form action="/api/oauth/decision" method="post" className="mt-6 flex flex-col gap-2.5">
        <input name="transaction_id" type="hidden" value={transactionId} />
        <Button
          type="submit"
          value="Allow"
          className="h-10"
          disabled={Boolean(decisionInfo.redirectUri) && !trusted}
        >
          {t('oauth:mcpDecision.continue')}
        </Button>
        <Button type="submit" value="Deny" name="cancel" variant="outline" className="h-10">
          {t('common:actions.cancel')}
        </Button>
      </form>
    </Card>
  );
};
