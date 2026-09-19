import type { ImgHTMLAttributes, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../shadcn';

interface IImageWithFallbackProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string;
  /** Rendered until `src` has decoded, and kept when it cannot be. */
  fallback: ReactNode;
}

/**
 * The fallback is what the user sees by default; the image only replaces it
 * once the browser has actually decoded it. Files the browser cannot render
 * (HEIC outside Safari, expired links, ...) keep the fallback instead of
 * leaving a broken image behind.
 */
export const ImageWithFallback = (props: IImageWithFallbackProps) => {
  const { src, fallback, ...imgProps } = props;
  if (!src) {
    return <>{fallback}</>;
  }
  // Keyed by src so a new url starts over from the fallback.
  return <LoadingImage key={src} src={src} fallback={fallback} {...imgProps} />;
};

type ILoadState = 'loading' | 'loaded' | 'failed';

const LoadingImage = (props: IImageWithFallbackProps & { src: string }) => {
  const { src, fallback, className, alt, onLoad, onError, ...imgProps } = props;
  const [state, setState] = useState<ILoadState>('loading');
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // A server-rendered <img> can finish before React attaches its listeners.
    const img = imgRef.current;
    if (img?.complete) {
      setState(img.naturalWidth > 0 ? 'loaded' : 'failed');
    }
  }, []);

  if (state === 'failed') {
    return <>{fallback}</>;
  }
  return (
    <>
      {state === 'loading' && fallback}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={cn(className, state === 'loading' && 'hidden')}
        onLoad={(e) => {
          setState('loaded');
          onLoad?.(e);
        }}
        onError={(e) => {
          setState('failed');
          onError?.(e);
        }}
        {...imgProps}
      />
    </>
  );
};
