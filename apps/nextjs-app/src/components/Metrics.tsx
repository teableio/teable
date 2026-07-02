import Script from 'next/script';
import { useEffect, useState } from 'react';
import { syncMarketingAttributionFromUrl } from '@/lib/marketing-attribution';

const GOOGLE_LINKER_DOMAINS = ['teable.ai', 'app.teable.ai'];

const POSTHOG_DEFAULT_HOST = 'https://us.i.posthog.com';
const INTERNAL_EMAIL_REGEX = /@teable\.(?:io|ai|cn)$/i;

interface IPostHog {
  init: (key: string, config: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
  reset: () => void;
}

declare global {
  interface Window {
    gtag?: (command: string, targetId: string | Date, config?: Record<string, unknown>) => void;
    dataLayer?: unknown[];
    posthog?: IPostHog;
  }
}

export const MicrosoftClarity = ({
  clarityId,
  user,
}: {
  clarityId?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
  };
}) => {
  if (!clarityId) {
    return null;
  }

  return (
    <>
      <Script
        id="microsoft-clarity-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
        (function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "${clarityId}");
        `,
        }}
      />
      <Script
        id="microsoft-clarity-identify"
        dangerouslySetInnerHTML={{
          __html: `window.clarity && window.clarity("identify", "${user?.email || user?.id}");`,
        }}
      />
    </>
  );
};

export const Umami = ({
  umamiWebSiteId,
  umamiUrl,
  user,
}: {
  umamiWebSiteId?: string;
  umamiUrl?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
  };
}) => {
  if (!umamiWebSiteId || !umamiUrl) {
    return null;
  }

  return (
    <>
      <Script
        id="umami-init"
        defer
        src={umamiUrl}
        data-website-id={umamiWebSiteId}
        onLoad={() => {
          if (user) {
            window.umami &&
              window.umami.identify({ email: user.email, id: user.id, name: user.name });
          }
        }}
      />
    </>
  );
};

export const GoogleAnalytics = ({
  gaId,
  googleAdsId,
  marketingGaId,
  user,
}: {
  gaId?: string;
  googleAdsId?: string;
  marketingGaId?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
  };
}) => {
  const scriptId = gaId ?? googleAdsId ?? marketingGaId;
  const userId = user?.id;
  const userEmail = user?.email;
  const [isGtagReady, setIsGtagReady] = useState(false);

  useEffect(() => {
    if (!isGtagReady || !window.gtag) {
      return;
    }

    syncMarketingAttributionFromUrl();

    const linker = { domains: GOOGLE_LINKER_DOMAINS };

    if (gaId) {
      // Always pass a 3rd arg. gtag.js crashes with "reading 'update'" when called
      // as gtag('config', id) (2-arg form) on cached library loads — only share view
      // hits this because it's the one page where pageProps.user is undefined.
      window.gtag(
        'config',
        gaId,
        userId ? { user_id: userId, custom_map: { custom_dimension_1: 'user_email' } } : {}
      );
    }

    if (googleAdsId) {
      window.gtag('config', googleAdsId, { linker });
    }

    if (marketingGaId) {
      window.gtag('config', marketingGaId, { linker });
    }
  }, [gaId, googleAdsId, isGtagReady, marketingGaId, userId]);

  useEffect(() => {
    if (!isGtagReady || !window.gtag || !gaId || !userEmail) {
      return;
    }

    window.gtag('event', 'login', {
      send_to: gaId,
      custom_dimension_1: userEmail,
    });
  }, [gaId, isGtagReady, userEmail]);

  if (!scriptId) {
    return null;
  }

  return (
    <>
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${scriptId}`}
      />
      <Script
        id="google-analytics-init"
        strategy="afterInteractive"
        onReady={() => setIsGtagReady(true)}
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
          `,
        }}
      />
    </>
  );
};

export const PostHog = ({
  posthogKey,
  posthogHost,
  user,
}: {
  posthogKey?: string;
  posthogHost?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
  };
}) => {
  const apiHost = posthogHost || POSTHOG_DEFAULT_HOST;
  const userId = user?.id;
  const userEmail = user?.email;
  const userName = user?.name;
  const [isReady, setIsReady] = useState(false);

  // Tie events to a stable person (user.id) once identified; reset on logged-out /
  // anonymous surfaces (e.g. share pages) so a previous identity doesn't leak.
  useEffect(() => {
    if (!isReady || !window.posthog) {
      return;
    }
    if (userId) {
      window.posthog.identify(userId, {
        email: userEmail,
        name: userName,
        is_employee: userEmail ? INTERNAL_EMAIL_REGEX.test(userEmail) : false,
      });
    } else {
      window.posthog.reset();
    }
  }, [isReady, userId, userEmail, userName]);

  if (!posthogKey) {
    return null;
  }

  return (
    <Script
      id="posthog-init"
      strategy="afterInteractive"
      onReady={() => setIsReady(true)}
      dangerouslySetInnerHTML={{
        __html: `
          !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
          posthog.init(${JSON.stringify(posthogKey)}, {
            api_host: ${JSON.stringify(apiHost)},
            capture_pageview: 'history_change',
            capture_pageleave: 'if_capture_pageview',
            // web_vitals off: fires several $web_vitals events per page load and
            // we don't act on them yet — growth events are the priority for quota.
            capture_performance: { web_vitals: false },
            autocapture: { css_selector_allowlist: ['[data-attr]'] },
            person_profiles: 'identified_only',
            persistence: 'localStorage+cookie'
          });
          // Session replay is NOT force-disabled here: it's gated remotely by the
          // PostHog project's replay settings, which link recording to the
          // 'new-user-session-replay' feature flag (signup_at within last 7 days).
          // Anonymous visitors never match the flag, so nothing records for them.
        `,
      }}
    />
  );
};
