import { useRouter } from 'next/router';
import { useEffect } from 'react';

let warmedUp = false;

/**
 * Warm the heavy client-only Table chunk (all view types, calendar, dnd-kit...)
 * and the base page bundle while the user is still browsing the space page, so
 * entering a base no longer waits for them on the critical path.
 *
 * Runs once per app lifetime, only when the browser is idle, and skips
 * data-saver / 2G connections.
 */
export const usePrefetchBaseEntry = () => {
  const router = useRouter();

  useEffect(() => {
    if (warmedUp) {
      return;
    }

    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    if (connection?.saveData || connection?.effectiveType === '2g') {
      return;
    }

    const warmUp = () => {
      warmedUp = true;
      // Warming up is best-effort: swallow every failure (offline, stale chunk
      // hash after a deploy...) so it can never surface on the space page.
      try {
        // Same module request as DynamicTable in base-node/TablePage.tsx, so it
        // resolves to the same chunk.
        import('@/features/app/blocks/table/Table').catch(() => {
          warmedUp = false;
        });
        router.prefetch('/base/[baseId]/[[...slug]]').catch(() => undefined);
      } catch {
        // ignore
      }
    };

    if (
      typeof window.requestIdleCallback === 'function' &&
      typeof window.cancelIdleCallback === 'function'
    ) {
      const handle = window.requestIdleCallback(warmUp, { timeout: 5000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(warmUp, 2000);
    return () => window.clearTimeout(timer);
  }, [router]);
};
