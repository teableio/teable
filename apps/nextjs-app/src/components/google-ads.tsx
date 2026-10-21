import { getMarketingAttribution } from '@/lib/marketing-attribution';

// Declare gtag types
declare global {
  interface Window {
    gtag?: (command: string, targetId: string | Date, config?: Record<string, unknown>) => void;
    dataLayer?: unknown[];
  }
}

interface IUserInfo {
  id: string;
  email: string;
  name?: string;
}

// Google Ads signup conversions upload server-side from gclid (backend-ee
// GoogleAdsConversionService) — a client-side ping here would double count.
function trackMarketingSignUp(marketingGaId?: string, userInfo?: IUserInfo) {
  if (typeof window === 'undefined' || !window.gtag || !marketingGaId || !userInfo) {
    return;
  }

  window.gtag('event', 'sign_up', {
    send_to: marketingGaId,
    method: 'email',
    user_id: userInfo.id,
    page_path: window.location.pathname,
    page_location: window.location.href,
    ...getMarketingAttribution(),
  });
}

export function trackSignUp({
  marketingGaId,
  userInfo,
}: {
  marketingGaId?: string;
  userInfo?: IUserInfo;
}) {
  trackMarketingSignUp(marketingGaId, userInfo);
}
