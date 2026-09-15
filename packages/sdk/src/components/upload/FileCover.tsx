import { useTheme } from '@teable/next-themes';
import { getFileIcon, ImageWithFallback } from '@teable/ui-lib';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';

interface IFileCoverProps {
  className?: string;
  style?: CSSProperties;
  mimetype: string;
  /** An image to show for the file (thumbnail, renderable original, local object url). */
  url?: string;
  name?: string;
  draggable?: boolean;
  /** Applied to the file icon. Font-size classes size the em-based glyphs only. */
  iconClassName?: string;
}

/**
 * Shows the file icon by default and swaps in `url` only once the browser has
 * decoded it, so a file the browser cannot render keeps its icon.
 */
export const FileCover = (props: IFileCoverProps) => {
  const { className, style, mimetype, url, name, draggable, iconClassName } = props;
  const { resolvedTheme } = useTheme();
  const FileIcon = useMemo(
    () => getFileIcon(mimetype, resolvedTheme as 'light' | 'dark'),
    [mimetype, resolvedTheme]
  );

  return (
    <ImageWithFallback
      className={className}
      style={style}
      src={url}
      alt={name}
      draggable={draggable}
      fallback={<FileIcon className={iconClassName} />}
    />
  );
};
