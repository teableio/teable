import { useContext, useEffect, useMemo, useState } from 'react';
import { cn } from '../../../../shadcn';
import { Spin } from '../../../spin/Spin';
import { FilePreviewContext, type IFileItemInner } from '../FilePreviewContext';
import { getFileIcon } from '../getFileIcon';

interface IHtmlPreviewProps extends IFileItemInner {}

/** Hard cap on auto-fetched preview content, matching TextPreview. */
const MAX_PREVIEW_BYTES = 1_000_000;

/**
 * Renders HTML files in a sandboxed iframe via a blob URL. The sandbox omits
 * `allow-same-origin` so scripts in the file can't reach the parent page —
 * a collaborator's uploaded HTML must not become an XSS vector.
 *
 * blob: documents inherit the parent page's CSP, so script execution here
 * relies on the app CSP allowing 'unsafe-inline'.
 */
export const HtmlPreview = (props: IHtmlPreviewProps) => {
  const { src, mimetype, name, size = 0 } = props;
  const { i18nMap } = useContext(FilePreviewContext);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverTooLarge, setServerTooLarge] = useState(false);

  const isTooLarge = size > MAX_PREVIEW_BYTES;
  const FileIcon = useMemo(() => getFileIcon(mimetype), [mimetype]);

  const renderUnavailablePreview = (message: string, className = 'text-muted-foreground') => (
    <div
      className={cn(
        'flex size-full flex-col items-center justify-center gap-4 px-6 text-center',
        className
      )}
    >
      <span className="flex h-40 w-40 overflow-hidden rounded-3xl" aria-hidden="true">
        <FileIcon className="size-full" />
      </span>
      <span>{message}</span>
    </div>
  );

  useEffect(() => {
    if (isTooLarge || !src) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    let url: string | null = null;
    setLoading(true);
    setError(null);
    setServerTooLarge(false);

    fetch(src, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // Content-Length backstop: the client-side size metadata can be missing or stale.
        const contentLength = Number(r.headers.get('content-length'));
        if (contentLength > MAX_PREVIEW_BYTES) {
          setServerTooLarge(true);
          ac.abort();
          return null;
        }
        return r.blob();
      })
      .then((blob) => {
        // A URL created after cleanup has run would never be revoked.
        if (blob == null || ac.signal.aborted) return;
        // Covers responses without a Content-Length header.
        if (blob.size > MAX_PREVIEW_BYTES) {
          setServerTooLarge(true);
          return;
        }
        // Retype without copying; force utf-8 for documents without <meta charset>.
        url = URL.createObjectURL(blob.slice(0, blob.size, 'text/html;charset=utf-8'));
        setBlobUrl(url);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setError(i18nMap?.['loadFileError'] || 'Failed to load file');
        }
      })
      .finally(() => setLoading(false));

    return () => {
      ac.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, isTooLarge, i18nMap]);

  if (isTooLarge || serverTooLarge) {
    return renderUnavailablePreview(
      i18nMap?.['textPreviewFileLimit'] ||
        'Preview file size limit: 1MB, please download to view instead.'
    );
  }

  if (loading) {
    return (
      <div className="flex size-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  if (error) {
    return renderUnavailablePreview(error, 'text-destructive');
  }

  if (blobUrl == null) return null;

  return (
    <iframe
      src={blobUrl}
      className="size-full rounded-md border border-border bg-white"
      sandbox="allow-scripts allow-modals"
      title={name}
    />
  );
};
