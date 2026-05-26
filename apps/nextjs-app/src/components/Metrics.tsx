import Script from 'next/script';
import { useEffect, useState } from 'react';
import { syncMarketingAttributionFromUrl } from '@/lib/marketing-attribution';

const GOOGLE_LINKER_DOMAINS = ['teable.ai', 'app.teable.ai'];

declare global {
  interface Window {
    gtag?: (command: string, targetId: string | Date, config?: Record<string, unknown>) => void;
    dataLayer?: unknown[];
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
