import {
  ANONYMOUS_USER_ID,
  CONSENT_REGION_COOKIE_NAME,
  MARKETING_CONSENT_COOKIE_NAME,
  isConsentGranted,
} from '@teable/core';
import { useRouter } from 'next/router';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { syncMarketingAttributionFromUrl } from '@/lib/marketing-attribution';
import { useMarketingConsent } from '@/lib/marketing-consent';

const GOOGLE_LINKER_DOMAINS = ['teable.ai', 'app.teable.ai'];

const POSTHOG_DEFAULT_HOST = 'https://us.i.posthog.com';
const INTERNAL_EMAIL_REGEX = /@teable\.(?:io|ai|cn)$/i;
// Dispatched (on window) by the init snippet's `loaded` callback once the real
// posthog-js SDK (array.js) has replaced the stub. Identity-STATE reads
// (_isIdentified / get_property) are only answerable after this: the stub has
// no _isIdentified at all, and its get_property merely queues the call and
// returns undefined.
const POSTHOG_LOADED_EVENT = 'teable:posthog-loaded';

interface IPostHog {
  init: (key: string, config: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
  reset: () => void;
  opt_in_capturing?: (options?: { captureEventName?: string | null }) => void;
  opt_out_capturing?: () => void;
  /**
   * Real SDK only — absent on the pre-load stub, which is how we detect that
   * array.js has loaded. Reads the persisted `$user_state` (covers both
   * persistence and sessionPersistence stores).
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _isIdentified?: () => boolean;
  /** Fallback identity-state read: persisted super property lookup. */
  get_property?: (propertyName: string) => unknown;
}

/**
 * Inline-script twin of lib/marketing-consent: the GA and PostHog init
 * snippets run before React effects, so they read the consent cookies
 * themselves. Opt-out regions default to granted unless denied; opt-in
 * regions (and unknown) need an explicit grant.
 */
const CONSENT_STATE_JS = `
  function __teableConsentState() {
    var cookies = document.cookie.split('; ');
    function read(name) {
      for (var i = 0; i < cookies.length; i++) {
        if (cookies[i].indexOf(name + '=') === 0) return cookies[i].slice(name.length + 1);
      }
    }
    var row = read(${JSON.stringify(CONSENT_REGION_COOKIE_NAME)}) === 'row';
    var raw = read(${JSON.stringify(MARKETING_CONSENT_COOKIE_NAME)});
    var choice = {};
    for (var n = 0; raw && n < 3; n++) {
      try { choice = JSON.parse(raw) || {}; break; } catch (e) {
        try { raw = decodeURIComponent(raw); } catch (e2) { break; }
      }
    }
    function granted(category) {
      return row ? choice[category] !== 'denied' : choice[category] === 'granted';
    }
    return {
      analytics: granted('analytics_storage'),
      ads: granted('ad_storage'),
      adUserData: granted('ad_user_data'),
      adPersonalization: granted('ad_personalization')
    };
  }
`;

const isPosthogSdkLoaded = (posthog?: IPostHog): boolean =>
  // eslint-disable-next-line no-underscore-dangle
  !!posthog && typeof posthog._isIdentified === 'function';

// Real user ids are NOT required to carry the usr prefix (EE admin/API-created
// users can have custom ids) — only empty values and the reserved word
// 'anonymous' (case-insensitive, matching PostHog's reserved distinct_id
// semantics) are excluded.
//
// Shared by EVERY analytics tool in this file (Umami, GA, PostHog):
// signed-out visitors on ensureLogin pages (/auth/login, /auth/signup via
// re-export, /invite, ...) get pageProps.user set to the backend's
// ANONYMOUS_USER, which carries a non-empty name ('Anonymous') and email
// ('anonymous@system.teable.ai') — so a truthy user or email is NOT proof of
// a signed-in account. Every identity call below must pass this gate.
const isIdentifiableUserId = (userId?: string): userId is string =>
  !!userId && userId.trim().toLowerCase() !== ANONYMOUS_USER_ID;

// Newest page user id, mirrored into module scope by the PostHog component so
// handlePosthogLoaded can read it synchronously: the init snippet renders only
// once, so a React closure captured there would go stale.
let latestPageUserId: string | undefined;

/**
 * Runs SYNCHRONOUSLY inside posthog's `loaded` config callback — i.e. BEFORE
 * the initial $pageview. posthog-js `_loaded()` invokes `config.loaded(this)`
 * first and only then schedules `_captureInitialPageview()` via
 * `setTimeout(..., 1)` ("this happens after loaded so a user can call identify
 * or any other things before the pageview fires" —
 * packages/browser/src/posthog-core.ts); `capture_pageview: 'history_change'`
 * is truthy and goes through that same deferred path. So cutting a stale
 * identity here guarantees the initial pageview of an anonymous load can never
 * be attributed to the previously identified user.
 */
const handlePosthogLoaded = (posthog: IPostHog) => {
  if (isIdentifiableUserId(latestPageUserId)) {
    // A real user is on the page — the identify effect owns this case.
    return;
  }
  // eslint-disable-next-line no-underscore-dangle
  if (typeof posthog._isIdentified === 'function' && posthog._isIdentified()) {
    posthog.reset();
  }
};

declare global {
  interface Window {
    gtag?: (command: string, targetId: string | Date, config?: Record<string, unknown>) => void;
    dataLayer?: unknown[];
    posthog?: IPostHog;
    fbq?: (...args: unknown[]) => void;
    /**
     * Hook invoked by the posthog init snippet's `loaded` callback with the
     * real SDK instance, before the event dispatch and the initial $pageview.
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __teablePosthogOnLoaded?: (posthog: IPostHog) => void;
    /** Set by the PostHog init snippet: true when it started cookieless. */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __teablePosthogCookieless?: boolean;
  }
}

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
  const userId = user?.id;
  const userEmail = user?.email;
  const userName = user?.name;
  const [isUmamiReady, setIsUmamiReady] = useState(false);

  // Identify from an effect, not the script's load callback alone: login goes
  // through a client-side router.push, which keeps this component mounted and
  // never re-fires onLoad — the session would stay unidentified until a full
  // page load. The effect re-runs whenever the user id changes (initial load,
  // login, account switch alike). Umami's script tracker has no reset API;
  // anonymous/invalid users skip identification and ride Umami's own visitor
  // id.
  useEffect(() => {
    if (!isUmamiReady || !isIdentifiableUserId(userId)) {
      return;
    }
    window.umami?.identify({ email: userEmail, id: userId, name: userName });
  }, [isUmamiReady, userId, userEmail, userName]);

  if (!umamiWebSiteId || !umamiUrl) {
    return null;
  }

  return (
    <Script
      id="umami-init"
      defer
      src={umamiUrl}
      data-website-id={umamiWebSiteId}
      onLoad={() => setIsUmamiReady(true)}
    />
  );
};

export const GoogleAnalytics = ({
  gaId,
  marketingGaId,
  user,
}: {
  gaId?: string;
  marketingGaId?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
  };
}) => {
  const scriptId = gaId ?? marketingGaId;
  const userId = user?.id;
  const userEmail = user?.email;
  const [isGtagReady, setIsGtagReady] = useState(false);
  const { analyticsGranted, adsGranted, consent, region } = useMarketingConsent();

  // Consent Mode: the init snippet sets the defaults from the cookies; later
  // choices (banner / Cookie settings) update them in place. Without consent
  // Google still receives cookieless pings for modelled conversions.
  useEffect(() => {
    if (!isGtagReady || !window.gtag) {
      return;
    }
    const status = (category: 'ad_user_data' | 'ad_personalization') =>
      isConsentGranted(region, consent, category) ? 'granted' : 'denied';
    window.gtag('consent', 'update', {
      analytics_storage: analyticsGranted ? 'granted' : 'denied',
      ad_storage: adsGranted ? 'granted' : 'denied',
      ad_user_data: status('ad_user_data'),
      ad_personalization: status('ad_personalization'),
    });
  }, [isGtagReady, analyticsGranted, adsGranted, consent, region]);

  // Last user id this page session sent to GA via config. _app stays mounted
  // across client-side navigations (logout does router.push('/auth/login')),
  // so the gtag session survives logout and an identified -> anonymous
  // transition is observable here (same pattern as the PostHog effect).
  const lastIdentifiedIdRef = useRef<string>(undefined);

  useEffect(() => {
    if (!isGtagReady || !window.gtag) {
      return;
    }

    // localStorage attribution (utm_* / gclid / ga_client_id) exists solely
    // for the GA/Ads conversion pipeline, so it syncs behind the same gate;
    // affiliate `via` rides the teable_affiliate_via cookie and never depends on this.
    syncMarketingAttributionFromUrl();

    const linker = { domains: GOOGLE_LINKER_DOMAINS };

    if (gaId) {
      // Always pass a 3rd arg. gtag.js crashes with "reading 'update'" when called
      // as gtag('config', id) (2-arg form) on cached library loads — only share view
      // hits this because it's the one page where pageProps.user is undefined.
      const previousId = lastIdentifiedIdRef.current;
      let identity: Record<string, unknown> = {};
      if (isIdentifiableUserId(userId)) {
        lastIdentifiedIdRef.current = userId;
        identity = { user_id: userId, custom_map: { custom_dimension_1: 'user_email' } };
      } else if (previousId) {
        // Logout in this page session: Google's User-ID spec requires an
        // explicit user_id: null to dissociate subsequent events from the
        // previous account — merely omitting the field would keep the login
        // page's events attached to it.
        lastIdentifiedIdRef.current = undefined;
        identity = { user_id: null };
      }
      // Never-identified visitors fall through with the empty config (no
      // user_id field at all), i.e. GA's regular un-identified client-id
      // tracking — same as no user.
      window.gtag('config', gaId, identity);
    }

    if (marketingGaId) {
      window.gtag('config', marketingGaId, { linker });
    }
  }, [gaId, isGtagReady, marketingGaId, userId]);

  useEffect(() => {
    // Gate on the id, not just the email: ANONYMOUS_USER carries a non-empty
    // email (anonymous@system.teable.ai), which would otherwise fire a fake
    // 'login' event for every signed-out visitor on ensureLogin pages.
    if (
      !isGtagReady ||
      !window.gtag ||
      !gaId ||
      !userEmail ||
      !isIdentifiableUserId(userId) ||
      // The email dimension rides only on consented (cookie) hits, never on
      // the cookieless pings Consent Mode sends without consent.
      !analyticsGranted
    ) {
      return;
    }

    window.gtag('event', 'login', {
      send_to: gaId,
      custom_dimension_1: userEmail,
    });
  }, [gaId, isGtagReady, userEmail, userId, analyticsGranted]);

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
            ${CONSENT_STATE_JS}
            var consentState = __teableConsentState();
            gtag('consent', 'default', {
              analytics_storage: consentState.analytics ? 'granted' : 'denied',
              ad_storage: consentState.ads ? 'granted' : 'denied',
              ad_user_data: consentState.adUserData ? 'granted' : 'denied',
              ad_personalization: consentState.adPersonalization ? 'granted' : 'denied',
              wait_for_update: 500
            });
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
  posthogWebHost,
  posthogUiHost,
  user,
}: {
  posthogKey?: string;
  posthogHost?: string;
  posthogWebHost?: string;
  posthogUiHost?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
  };
}) => {
  // POSTHOG_WEB_HOST is the browser-only reverse proxy (ad-blocker evasion);
  // server-side ingest keeps reading POSTHOG_HOST and never follows it.
  const apiHost = posthogWebHost || posthogHost || POSTHOG_DEFAULT_HOST;
  // On a reverse-proxy api_host the SDK can't infer the PostHog web-app
  // origin (toolbar, links back into the app) — proxied deployments must set
  // POSTHOG_UI_HOST explicitly. null keeps the SDK default (infer/api_host),
  // which is correct for direct cloud and self-hosted PostHog alike.
  const uiHost = posthogUiHost || null;
  const userId = user?.id;
  const userEmail = user?.email;
  const userName = user?.name;
  const [isReady, setIsReady] = useState(false);
  const { analyticsGranted } = useMarketingConsent();

  // Last user id this page session identified with. _app stays mounted across
  // client-side navigations (logout does router.push('/auth/login')), so an
  // in-session account switch is observable here even before the SDK loads.
  const lastIdentifiedIdRef = useRef<string>(undefined);

  // Mirror the newest user id into module scope for handlePosthogLoaded (the
  // snippet renders once; a closure captured in it would go stale). Effects
  // run at mount, long before array.js can finish loading over the network.
  useEffect(() => {
    latestPageUserId = userId;
  }, [userId]);

  // Expose the loaded hook the init snippet calls with the real SDK instance.
  useEffect(() => {
    window.__teablePosthogOnLoaded = handlePosthogLoaded;
    return () => {
      window.__teablePosthogOnLoaded = undefined;
    };
  }, []);

  // Flips when the real SDK replaces the stub (loaded callback dispatches
  // POSTHOG_LOADED_EVENT) so the identity effect re-runs once identity STATE
  // becomes readable — later anonymous transitions depend on it.
  const [isSdkLoaded, setIsSdkLoaded] = useState(false);
  useEffect(() => {
    if (isPosthogSdkLoaded(window.posthog)) {
      setIsSdkLoaded(true);
      return;
    }
    const markLoaded = () => setIsSdkLoaded(true);
    window.addEventListener(POSTHOG_LOADED_EVENT, markLoaded);
    return () => window.removeEventListener(POSTHOG_LOADED_EVENT, markLoaded);
  }, []);

  // Tie events to a stable person (user.id) once identified.
  //
  // Never identify with the backend's ANONYMOUS_USER id: signed-out visitors
  // on ensureLogin pages (/auth/login, /auth/signup via re-export, /invite,
  // ...) get pageProps.user = { id: 'anonymous', ... } — a PostHog reserved
  // distinct_id: events are ingested but person merges are rejected, so
  // identifying with it piles every signed-out visitor onto one giant mixed
  // person and breaks anonymous -> signup attribution (see
  // isIdentifiableUserId for what counts as a real id).
  //
  // On anonymous surfaces, reset() is driven by the SDK's PERSISTED identity
  // state, not by page-session memory alone:
  // - SDK currently identified (in-session logout, or a stale identity left
  //   in localStorage after the auth cookie expired/cleared) -> reset(), so
  //   anonymous pageviews stop accruing to the previous user. For the
  //   fresh-load case the verdict already happened synchronously in
  //   handlePosthogLoaded, BEFORE the initial $pageview; this effect is the
  //   equivalent for identity changes after load (and a fallback).
  // - SDK anonymous -> do nothing: the landing pageview (capture_pageview:
  //   'history_change', incl. utm_*) is already recorded under the SDK's own
  //   anonymous id, and reset() would rotate that id and wipe persistence,
  //   permanently detaching landing/UTM events from the person created when
  //   the visitor signs up and identifies.
  // Consent changes after load. A cookieless start (opt-in region, no
  // choice yet) switches to cookie persistence on grant — posthog-js
  // cookieless_mode 'on_reject' semantics. Withdrawing a grant stops capture
  // for the rest of this page; the next load starts cookieless again.
  useEffect(() => {
    const posthog = window.posthog;
    if (!isSdkLoaded || !posthog) {
      return;
    }
    const cookieless = window.__teablePosthogCookieless === true;
    if (analyticsGranted && cookieless) {
      posthog.opt_in_capturing?.({ captureEventName: null });
      window.__teablePosthogCookieless = false;
    } else if (!analyticsGranted && !cookieless) {
      posthog.opt_out_capturing?.();
    }
  }, [isSdkLoaded, analyticsGranted]);

  useEffect(() => {
    const posthog = window.posthog;
    if (!isReady || !posthog) {
      return;
    }
    if (!analyticsGranted) {
      // Cookieless mode has no persistent identity: person profiles and
      // identify() need consent.
      return;
    }
    const previousId = lastIdentifiedIdRef.current;
    if (isIdentifiableUserId(userId)) {
      if (previousId && previousId !== userId) {
        // Account switch: drop the previous identity before adopting the new
        // one so events never bleed across users.
        posthog.reset();
      }
      lastIdentifiedIdRef.current = userId;
      // Safe to run pre-load: the stub queues identify and replays it once
      // array.js arrives. Re-running post-load re-identifies with the same
      // id, which posthog-js treats as a no-op property update.
      posthog.identify(userId, {
        email: userEmail,
        name: userName,
        is_employee: userEmail ? INTERNAL_EMAIL_REGEX.test(userEmail) : false,
      });
      return;
    }
    lastIdentifiedIdRef.current = undefined;
    // Identity state is only trustworthy once the real SDK is present; until
    // then skip — the isSdkLoaded flip re-runs this effect with the answer.
    const isIdentified =
      isSdkLoaded &&
      // eslint-disable-next-line no-underscore-dangle
      (typeof posthog._isIdentified === 'function'
        ? // eslint-disable-next-line no-underscore-dangle
          posthog._isIdentified()
        : posthog.get_property?.('$user_state') === 'identified');
    if (isIdentified) {
      posthog.reset();
    }
  }, [isReady, isSdkLoaded, userId, userEmail, userName, analyticsGranted]);

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
          ${CONSENT_STATE_JS}
          // Without analytics consent (opt-in regions until they accept)
          // PostHog runs cookieless: events are still counted, but nothing is
          // stored on the device and no session is recorded. Elsewhere the
          // config is unchanged.
          var cookieless = !__teableConsentState().analytics;
          window.__teablePosthogCookieless = cookieless;
          posthog.init(${JSON.stringify(posthogKey)}, {
            cookieless_mode: cookieless ? 'on_reject' : undefined,
            disable_session_recording: cookieless,
            api_host: ${JSON.stringify(apiHost)},
            ui_host: ${JSON.stringify(uiHost)},
            capture_pageview: 'history_change',
            capture_pageleave: 'if_capture_pageview',
            // web_vitals off: fires several $web_vitals events per page load and
            // we don't act on them yet — growth events are the priority for quota.
            capture_performance: { web_vitals: false },
            autocapture: { css_selector_allowlist: ['[data-attr]'] },
            // Code-level privacy backstop for session replay. These mirror the
            // PostHog project's "Privacy and masking" settings; init options
            // take precedence over the remote ones, so a project-settings
            // change can never start recording text, inputs or media.
            session_recording: {
              maskAllInputs: true,
              maskTextSelector: '*',
              blockSelector: 'img, video',
            },
            // Console output can carry tokens, emails or record data. An
            // explicit false wins over the remote "capture console logs"
            // toggle (undefined would fall back to it).
            enable_recording_console_log: false,
            logs: { captureConsoleLogs: false },
            person_profiles: 'identified_only',
            persistence: 'localStorage+cookie',
            // Runs synchronously BEFORE posthog schedules the initial $pageview
            // (deferred via setTimeout in posthog-js _loaded()). The hook cuts a
            // stale identified distinct_id on anonymous loads so that pageview
            // can't be attributed to the previous user; the event then tells the
            // React layer the real SDK replaced the stub (identity state is only
            // readable from here on).
            loaded: function (ph) {
              // Line PostHog's own consent state up with ours before the
              // initial $pageview. In cookieless_mode 'on_reject' nothing is
              // captured until a decision exists, and opting out is what
              // switches capture to cookieless. A stale opt-out stored by an
              // earlier visit must not silence a visitor who has since agreed.
              if (cookieless) {
                ph.opt_out_capturing();
              } else if (ph.has_opted_out_capturing()) {
                ph.opt_in_capturing({ captureEventName: null });
              }
              if (window.__teablePosthogOnLoaded) {
                try { window.__teablePosthogOnLoaded(ph); } catch (e) {}
              }
              window.dispatchEvent(new Event(${JSON.stringify(POSTHOG_LOADED_EVENT)}));
            }
          });
          // Session replay is NOT force-disabled here: it's gated remotely by the
          // PostHog project's replay settings, which link recording to the
          // 'new-user-session-replay' feature flag (signup_at within last 7 days).
          // Anonymous visitors never match the flag, so nothing records for them.
          // Masking, by contrast, is pinned above in session_recording.
        `,
      }}
    />
  );
};

interface IMetaPixelProps {
  metaPixelId?: string;
}

// Whether the init snippet's own PageView already covered an auth view this
// page load — module scope: it must survive the component unmount/remount of
// an auth → product → auth SPA round trip, exactly like the script itself.
let initialAuthViewTracked = false;

/**
 * Pre-auth (/auth/*) only: plants _fbp for direct-to-app ad landings;
 * conversions go server-side (CAPI). Product pages never FIRE it — a script
 * loaded on /auth/* survives SPA navigation (unloading a <script> tag cannot
 * unload the runtime), but nothing is sent outside /auth/*.
 * Consent: ad_storage via lib/marketing-consent — opt-in regions need an
 * explicit grant (the app shows its own banner to direct visitors); other
 * regions load unless the visitor rejected.
 */
export const MetaPixel = ({ metaPixelId }: IMetaPixelProps) => {
  const router = useRouter();
  const isPreAuth = router.pathname.startsWith('/auth/');
  const { adsGranted } = useMarketingConsent();
  // null until mounted: the server snapshot can't see the consent cookies.
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isPreAuth || !metaPixelId) {
      return;
    }
    setBlocked(!adsGranted);
  }, [isPreAuth, metaPixelId, adsGranted]);

  // One PageView per auth-page view. The init snippet covers only the very
  // first (script injection is once per full page load), so every later auth
  // view — path change or SPA re-entry after leaving — fires from here.
  const trackedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (blocked !== false || !isPreAuth) {
      trackedPathRef.current = null;
      return;
    }
    if (!initialAuthViewTracked) {
      initialAuthViewTracked = true;
    } else if (trackedPathRef.current !== router.pathname) {
      window.fbq?.('track', 'PageView');
    }
    trackedPathRef.current = router.pathname;
  }, [blocked, isPreAuth, router.pathname]);

  if (!metaPixelId || !isPreAuth || blocked !== false) {
    return null;
  }

  return (
    <Script
      id="meta-pixel-init"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `
          !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){
          n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];
          t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window,document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', ${JSON.stringify(metaPixelId)});
          fbq('track', 'PageView');
        `,
      }}
    />
  );
};
