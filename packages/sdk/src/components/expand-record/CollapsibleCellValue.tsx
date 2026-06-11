import { Button } from '@teable/ui-lib';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';

const MAX_HEIGHT = 200;

interface ICollapsibleCellValueProps {
  children: ReactNode;
}

export const CollapsibleCellValue = ({ children }: ICollapsibleCellValueProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const checkOverflow = useCallback(() => {
    if (contentRef.current) {
      setNeedsCollapse(contentRef.current.scrollHeight > MAX_HEIGHT);
    }
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [checkOverflow]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !expanded) return;

    const observer = new IntersectionObserver(([entry]) => setIsAtBottom(entry.isIntersecting), {
      threshold: 1,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [expanded]);

  const handleCollapse = useCallback(() => {
    setExpanded(false);
    requestAnimationFrame(() => {
      containerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  }, []);

  return (
    <div ref={containerRef} className={!needsCollapse || expanded ? undefined : 'relative'}>
      <div
        ref={contentRef}
        className={
          !needsCollapse || expanded
            ? '[&_*]:[-webkit-line-clamp:unset]'
            : 'overflow-hidden [&_*]:[-webkit-line-clamp:unset]'
        }
        style={!needsCollapse || expanded ? undefined : { maxHeight: MAX_HEIGHT }}
      >
        {children}
      </div>
      {needsCollapse && !expanded && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background via-background/100 to-transparent" />
          <Button
            variant="ghost"
            size="sm"
            className="relative z-10 px-0 text-blue-500 hover:bg-transparent hover:text-blue-700 hover:dark:text-blue-300"
            onClick={() => setExpanded(true)}
          >
            {t('expandRecord.showMore')}
          </Button>
        </>
      )}
      {needsCollapse && expanded && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className={
              isAtBottom
                ? 'px-0 text-blue-500 hover:bg-transparent hover:text-blue-700 hover:dark:text-blue-300'
                : 'sticky -bottom-4 z-10 rounded-full bg-popover text-blue-500 shadow-md hover:bg-popover hover:text-blue-700 hover:dark:text-blue-300'
            }
            onClick={handleCollapse}
          >
            {t('expandRecord.showLess')}
          </Button>
          <div ref={sentinelRef} className="h-px" />
        </>
      )}
    </div>
  );
};
