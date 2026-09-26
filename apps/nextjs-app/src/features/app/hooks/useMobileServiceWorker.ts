import { useEffect } from 'react';
import { detectEmbedMode } from '@/lib/embed-mode';

/** Generated after `next build` by scripts/build-mobile-precache.mjs into public/. */
export const MOBILE_SERVICE_WORKER_URL = '/mobile-sw.js';

const isMobileServiceWorker = (registration: ServiceWorkerRegistration) => {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  return Boolean(worker && new URL(worker.scriptURL).pathname === MOBILE_SERVICE_WORKER_URL);
};

/**
 * Registers the mobile app-shell service worker — only inside the native
 * mobile app's WebView (embed mode), after the page has loaded, never on
 * desktop. Outside production builds it instead removes any leftover
 * registration: the worker serves `/_next/static/*` cache-first, which would
 * pin stale chunks against a dev server.
 */
export const useMobileServiceWorker = () => {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!detectEmbedMode()) return;
    const container = navigator.serviceWorker;

    if (process.env.NODE_ENV !== 'production') {
      container
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations
              .filter(isMobileServiceWorker)
              .map((registration) => registration.unregister())
          )
        )
        .catch(() => undefined);
      return;
    }

    const register = () => {
      container.register(MOBILE_SERVICE_WORKER_URL, { scope: '/' }).catch((error) => {
        console.warn('[mobile-sw] registration failed', error);
      });
    };
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);
};
