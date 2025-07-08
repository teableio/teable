import { Skeleton } from '@teable/ui-lib/shadcn';
import html2canvas from 'html2canvas';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCodeBlobPreview } from './useCodeBlobPreview';

interface CodePreviewImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  code?: string;
}

export const CodePreviewImage = (props: CodePreviewImageProps) => {
  const { code, alt, ...rest } = props;
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = useCodeBlobPreview(code);

  const captureIframe = useCallback(async () => {
    setIsCapturing(true);
    try {
      const body = iframeRef.current?.contentDocument?.body;
      if (!body) {
        console.log('body is null');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const canvas = await html2canvas(body, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        logging: false,
      });

      const imageUrl = canvas.toDataURL('image/png');
      setPreviewImage(imageUrl);
    } catch (error) {
      console.error('Failed to capture iframe:', error);
    } finally {
      setIsCapturing(false);
    }
  }, []);

  useEffect(() => {
    if (previewImage && src) {
      URL.revokeObjectURL(src);
    }
  }, [previewImage, src]);

  return (
    <>
      {isCapturing ? (
        <Skeleton className="size-full" />
      ) : (
        previewImage && <img {...rest} src={previewImage} alt={alt} />
      )}
      {!previewImage && src && (
        <iframe
          ref={iframeRef}
          className="absolute -z-50 size-full"
          src={src}
          title="URL Preview"
          loading="lazy"
          onLoad={() => {
            captureIframe();
          }}
        />
      )}
    </>
  );
};
