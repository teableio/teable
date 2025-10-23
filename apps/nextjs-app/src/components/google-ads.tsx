// Declare gtag types
declare global {
  interface Window {
    gtag: (command: string, targetId: string | Date, config?: Record<string, unknown>) => void;
    dataLayer: unknown[];
  }
}

interface IUserInfo {
  id: string;
  email: string;
  name?: string;
}

// SHA-256 hash function for email
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Cookie helper function
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const nameEQ = name + '=';
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

// Check if user has consented to ad tracking
function hasAdConsent(): boolean {
  if (typeof window === 'undefined') return false;

  const CONSENT_COOKIE_NAME = 'teable_consent';
  const savedConsent = getCookie(CONSENT_COOKIE_NAME);

  if (!savedConsent) {
    return false;
  }

  try {
    const preferences = JSON.parse(decodeURIComponent(savedConsent));
    return preferences.ad_user_data === 'granted';
  } catch {
    return false;
  }
}

// Export function to track sign-up conversion with user information
export async function trackSignUpConversion(conversionId?: string, userInfo?: IUserInfo) {
  if (typeof window === 'undefined' || !window.gtag || !conversionId || !userInfo) {
    return;
  }

  // Hash email for privacy (Google Ads Enhanced Conversions)
  const hashedEmail = await sha256(userInfo.email.toLowerCase().trim());
  let conversionData: Record<string, unknown> = {
    send_to: conversionId,
  };

  if (hasAdConsent()) {
    conversionData = {
      ...conversionData,
      user_id: userInfo.id,
      user_data: {
        email: hashedEmail,
      },
    };
  }

  window.gtag('event', 'conversion', conversionData);
}
