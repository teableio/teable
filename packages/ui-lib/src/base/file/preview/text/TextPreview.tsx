import { useContext, useEffect, useMemo, useState } from 'react';
import { cn } from '../../../../shadcn';
import { MarkdownReadonly } from '../../../markdown';
import { Spin } from '../../../spin/Spin';
import { FilePreviewContext, type IFileItemInner } from '../FilePreviewContext';
import { getFileIcon } from '../getFileIcon';
import { isMarkdown } from '../utils';

interface ITextPreviewProps extends IFileItemInner {}

/**
 * Hard cap on auto-fetched preview content. 1 MB is roughly half a million
 * UTF-8 characters of prose, which already strains <pre> rendering — anything
 * larger should fall back to "download instead" to keep the UI responsive.
 */
const MAX_PREVIEW_BYTES = 1_000_000;

/**
 * Renders text-like file bodies inside the lightbox. Fetches via the presigned
 * URL and shows the result in a `<pre>` block — React's automatic JSX escaping
 * neutralizes any HTML/script content in the file, so this path is safe even
 * for `text/html` or `.svg` (the body shows as literal characters, the browser
 * never builds a script/img/iframe DOM from it).
 */
export const TextPreview = (props: ITextPreviewProps) => {
  const { src, mimetype, size = 0 } = props;
  const { i18nMap } = useContext(FilePreviewContext);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverTooLarge, setServerTooLarge] = useState(false);

  const isTooLarge = size > MAX_PREVIEW_BYTES;
  const renderAsMarkdown = isMarkdown(mimetype);
  const FileIcon = useMemo(() => getFileIcon(mimetype), [mimetype]);

  const renderUnavailablePreview = (message: string, className = 'text-zinc-300') => (
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
    setLoading(true);
    setError(null);
    setServerTooLarge(false);

    fetch(src, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // Backstop the client-side size check: cell metadata can be missing or
        // stale, so honor the server's Content-Length before reading the body.
        const contentLength = Number(r.headers.get('content-length'));
        if (contentLength > MAX_PREVIEW_BYTES) {
          setServerTooLarge(true);
          ac.abort();
          return null;
        }
        return r.text();
      })
      .then((value) => {
        if (value != null) setText(value);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setError(i18nMap?.['loadFileError'] || 'Failed to load file');
        }
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
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
    return renderUnavailablePreview(error, 'text-red-400');
  }

  if (text == null) return null;

  if (renderAsMarkdown) {
    return (
      <div className="size-full overflow-auto rounded-md bg-zinc-900 p-6">
        <div className="prose prose-sm prose-invert max-w-none">
          <MarkdownReadonly value={text} />
        </div>
      </div>
    );
  }

  return (
    <pre
      className={cn(
        'size-full overflow-auto whitespace-pre-wrap break-words',
        'rounded-md bg-zinc-900 p-4',
        'font-mono text-[13px] leading-[20px] text-zinc-100'
      )}
    >
      {text}
    </pre>
  );
};
