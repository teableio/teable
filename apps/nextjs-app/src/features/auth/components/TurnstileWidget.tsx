import { useCallback, useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (element: string | HTMLElement, options: TurnstileOptions) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
      getResponse: (widgetId?: string) => string;
    };
  }
}

interface TurnstileOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  'after-interactive-callback'?: () => void;
  'before-interactive-callback'?: () => void;
  'unsupported-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
  tabindex?: number;
  'response-field'?: boolean;
  'response-field-name'?: string;
  size?: 'normal' | 'compact';
  retry?: 'auto' | 'never';
  'retry-interval'?: number;
  'refresh-expired'?: 'auto' | 'manual' | 'never';
  appearance?: 'always' | 'execute' | 'interaction-only';
  execution?: 'render' | 'execute';
  action?: string;
  cdata?: string;
}

interface TurnstileWidgetProps {
  siteKey: string;
  onVerify?: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
  onTimeout?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact';
  action?: string;
  cdata?: string;
  className?: string;
}

export const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({
  siteKey,
  onVerify,
  onError,
  onExpire,
  onTimeout,
  theme = 'auto',
  size = 'normal',
  action,
  cdata,
  className,
}) => {
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>();
  const scriptLoadedRef = useRef<boolean>(false);

  const loadTurnstileScript = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (scriptLoadedRef.current || window.turnstile) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;

      script.onload = () => {
        scriptLoadedRef.current = true;
        resolve();
      };

      script.onerror = () => {
        reject(new Error('Failed to load Turnstile script'));
      };

      document.head.appendChild(script);
    });
  };

  const renderWidget = useCallback(() => {
    if (!widgetRef.current || !window.turnstile || !siteKey) {
      return;
    }

    // Remove existing widget if any
    if (widgetIdRef.current) {
      window.turnstile.remove(widgetIdRef.current);
    }

    const options: TurnstileOptions = {
      sitekey: siteKey,
      callback: onVerify,
      'error-callback': onError,
      'expired-callback': onExpire,
      'timeout-callback': onTimeout,
      theme,
      size,
      action,
      cdata,
    };

    try {
      widgetIdRef.current = window.turnstile.render(widgetRef.current, options);
    } catch (error) {
      console.error('Failed to render Turnstile widget:', error);
      onError?.();
    }
  }, [siteKey, onVerify, onError, onExpire, onTimeout, theme, size, action, cdata]);

  useEffect(() => {
    if (!siteKey) return;

    loadTurnstileScript()
      .then(() => {
        renderWidget();
      })
      .catch((error) => {
        console.error('Failed to load Turnstile:', error);
        if (onError) {
          onError();
        }
      });

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
  }, [siteKey, renderWidget, onError]);

  // Reset widget when callbacks change
  useEffect(() => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [onVerify, onError, onExpire, onTimeout]);

  if (!siteKey) {
    return null;
  }

  return <div ref={widgetRef} className={className} />;
};

export default TurnstileWidget;
