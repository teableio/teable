import { trackEvent } from '@teable/openapi';
import { useCallback, useRef } from 'react';

// eslint-disable-next-line @typescript-eslint/naming-convention
const DEBOUNCE_MS = 1000;

export function useTrack() {
  const lastEmit = useRef<Record<string, number>>({});

  const track = useCallback((event: string, properties?: Record<string, unknown>) => {
    const now = Date.now();
    if (now - (lastEmit.current[event] ?? 0) < DEBOUNCE_MS) {
      return;
    }
    lastEmit.current[event] = now;

    // Fire-and-forget
    trackEvent({ event, properties }).catch(() => {
      /* ignore tracking failures */
    });
  }, []);

  return { track };
}
