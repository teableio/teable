/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import { X, ChevronLeft, ChevronRight, Download, Trash2 } from '@teable/icons';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '../../../hooks/use-is-mobile';
import { Dialog, DialogContent, DialogTrigger, cn } from '../../../shadcn';
import { FilePreview } from './FilePreview';
import { FilePreviewContext } from './FilePreviewContext';
import { Thumb } from './Thumb';

const MOBILE_NAVIGATION_IDLE_DELAY = 2000;
const HEADER_BUTTON_CLASS = 'flex size-8 items-center justify-center rounded-md hover:bg-black/40';
const ATTACHMENT_NAVIGATION_BUTTON_CLASS =
  'absolute top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none sm:size-auto sm:rounded-none sm:border-0 sm:bg-transparent sm:shadow-none sm:transition-none';

export const FilePreviewContent = (props: { container?: HTMLElement | null }) => {
  const { container } = props;
  const { files, currentFile, openPreview, closePreview, onPrev, onNext, i18nMap } =
    useContext(FilePreviewContext);
  const isMobile = useIsMobile(640);
  const { name, fileId, src, downloadUrl, onDelete } = currentFile || {};
  const open = Boolean(fileId);
  const thumbnailContainerRef = useRef<HTMLDivElement | null>(null);
  const activeThumbnailRef = useRef<HTMLButtonElement>(null);
  const mobileNavigationTimerRef = useRef<number>();
  const [thumbnailScrollEdges, setThumbnailScrollEdges] = useState({
    left: false,
    right: false,
  });
  const [isMobileNavigationVisible, setIsMobileNavigationVisible] = useState(true);
  const hasMultipleFiles = files.length > 1;
  const shouldAutoHideMobileNavigation = isMobile && open && hasMultipleFiles;

  const hiddenLeft = useMemo(() => {
    return files.length < 2 || currentFile?.fileId === files[0].fileId;
  }, [currentFile?.fileId, files]);
  const hiddenRight = useMemo(() => {
    return files.length < 2 || currentFile?.fileId === files[files.length - 1].fileId;
  }, [currentFile?.fileId, files]);

  const updateThumbnailScrollEdges = useCallback(() => {
    const container = thumbnailContainerRef.current;
    if (!container) return;

    const nextEdges = {
      left: container.scrollLeft > 1,
      right: container.scrollLeft + container.clientWidth < container.scrollWidth - 1,
    };
    setThumbnailScrollEdges((previousEdges) => {
      if (previousEdges.left === nextEdges.left && previousEdges.right === nextEdges.right) {
        return previousEdges;
      }
      return nextEdges;
    });
  }, []);

  const thumbnailMaskImage = useMemo(() => {
    const { left, right } = thumbnailScrollEdges;
    if (left && right) {
      return 'linear-gradient(to right, transparent, black 1rem, black calc(100% - 1rem), transparent)';
    }
    if (left) {
      return 'linear-gradient(to right, transparent, black 1rem, black)';
    }
    if (right) {
      return 'linear-gradient(to right, black, black calc(100% - 1rem), transparent)';
    }
  }, [thumbnailScrollEdges]);

  const centerActiveThumbnail = useCallback(() => {
    const container = thumbnailContainerRef.current;
    const activeThumbnail = activeThumbnailRef.current;
    if (!container || !activeThumbnail) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = activeThumbnail.getBoundingClientRect();
    const left =
      container.scrollLeft +
      activeRect.left -
      containerRect.left -
      (container.clientWidth - activeRect.width) / 2;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({
      left: Math.max(0, left),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
    updateThumbnailScrollEdges();
  }, [updateThumbnailScrollEdges]);

  const setThumbnailContainer = useCallback(
    (node: HTMLDivElement | null) => {
      thumbnailContainerRef.current = node;
      if (node) {
        requestAnimationFrame(centerActiveThumbnail);
      }
    },
    [centerActiveThumbnail]
  );

  useEffect(() => {
    const container = thumbnailContainerRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver(centerActiveThumbnail);

    centerActiveThumbnail();
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [centerActiveThumbnail, currentFile?.fileId, files.length, isMobile]);

  const clearMobileNavigationTimer = useCallback(() => {
    if (mobileNavigationTimerRef.current === undefined) return;
    window.clearTimeout(mobileNavigationTimerRef.current);
    mobileNavigationTimerRef.current = undefined;
  }, []);

  const revealMobileNavigation = useCallback(() => {
    if (!shouldAutoHideMobileNavigation) return;

    clearMobileNavigationTimer();
    setIsMobileNavigationVisible(true);
    mobileNavigationTimerRef.current = window.setTimeout(() => {
      const activeElement = document.activeElement;
      const keepsKeyboardFocusVisible =
        activeElement instanceof HTMLElement &&
        activeElement.dataset.attachmentNavigation === 'true' &&
        activeElement.matches(':focus-visible');

      if (!keepsKeyboardFocusVisible) {
        setIsMobileNavigationVisible(false);
      }
      mobileNavigationTimerRef.current = undefined;
    }, MOBILE_NAVIGATION_IDLE_DELAY);
  }, [clearMobileNavigationTimer, shouldAutoHideMobileNavigation]);

  useEffect(() => {
    clearMobileNavigationTimer();
    if (shouldAutoHideMobileNavigation) {
      revealMobileNavigation();
    } else {
      setIsMobileNavigationVisible(true);
    }

    return clearMobileNavigationTimer;
  }, [
    clearMobileNavigationTimer,
    currentFile?.fileId,
    revealMobileNavigation,
    shouldAutoHideMobileNavigation,
  ]);

  const clickFileBox = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if ('id' in e.target && e.target.id === 'file-box') {
      closePreview();
    }
  };

  const onDownload = () => {
    const href = downloadUrl || src;
    if (!name || !href) return;
    const downloadLink = document.createElement('a');
    downloadLink.href = href;
    downloadLink.target = isMobile ? '_self' : '_blank';
    downloadLink.download = name;
    downloadLink.click();
  };

  return (
    <Dialog open={open} modal>
      <DialogTrigger asChild />
      <DialogContent
        container={container}
        closeable={false}
        className="size-full max-w-none rounded-none bg-black/75 px-0 py-0 text-white click-outside-ignore sm:px-4"
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          revealMobileNavigation();
          e.stopPropagation();
        }}
        onPointerMove={revealMobileNavigation}
        onTouchStart={revealMobileNavigation}
        onWheel={revealMobileNavigation}
        onScrollCapture={revealMobileNavigation}
        onFocusCapture={revealMobileNavigation}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          revealMobileNavigation();
          if (e.key === 'Escape') {
            closePreview();
          }
          if (e.key === 'ArrowRight') {
            onNext();
          }
          if (e.key === 'ArrowLeft') {
            onPrev();
          }
          e.stopPropagation();
        }}
      >
        <div className="flex size-full min-h-0 flex-col overflow-hidden">
          <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2.5 sm:px-5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={HEADER_BUTTON_CLASS}
                onClick={onDownload}
                aria-label="Download"
              >
                <Download className="text-xl" />
              </button>
              {onDelete && (
                <button
                  type="button"
                  className={HEADER_BUTTON_CLASS}
                  onClick={() => onDelete()}
                  aria-label={i18nMap?.deleteAttachment || 'Delete'}
                >
                  <Trash2 className="text-xl" />
                </button>
              )}
            </div>
            <h2 className="min-w-0 truncate text-center" title={name}>
              {name}
            </h2>
            <button
              type="button"
              className={cn(HEADER_BUTTON_CLASS, 'justify-self-end')}
              onClick={closePreview}
              aria-label="Close"
            >
              <X className="text-xl" />
            </button>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden px-0 sm:px-20">
            <button
              type="button"
              className={cn(
                ATTACHMENT_NAVIGATION_BUTTON_CLASS,
                'start-3 sm:start-0 sm:ms-0.5',
                shouldAutoHideMobileNavigation &&
                  !isMobileNavigationVisible &&
                  '-translate-x-10 rtl:translate-x-10',
                hiddenLeft && 'hidden'
              )}
              data-attachment-navigation="true"
              aria-label={i18nMap?.previousAttachment || 'Previous'}
              onClick={onPrev}
            >
              <ChevronLeft className="size-5 sm:size-[1em] sm:text-6xl" />
            </button>
            <div
              id="file-box"
              className="h-full flex items-center justify-center"
              onClick={clickFileBox}
            >
              <FilePreview />
            </div>
            <button
              type="button"
              className={cn(
                ATTACHMENT_NAVIGATION_BUTTON_CLASS,
                'end-3 sm:end-0 sm:me-0.5',
                shouldAutoHideMobileNavigation &&
                  !isMobileNavigationVisible &&
                  'translate-x-10 rtl:-translate-x-10',
                hiddenRight && 'hidden'
              )}
              data-attachment-navigation="true"
              aria-label={i18nMap?.nextAttachment || 'Next'}
              onClick={onNext}
            >
              <ChevronRight className="size-5 sm:size-[1em] sm:text-6xl" />
            </button>
          </div>
          <div className="relative shrink-0 px-2 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
            <div className="flex items-center">
              <div
                ref={setThumbnailContainer}
                className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
                style={{
                  WebkitMaskImage: thumbnailMaskImage,
                  maskImage: thumbnailMaskImage,
                }}
                onScroll={updateThumbnailScrollEdges}
              >
                <div className="flex w-max min-w-full justify-center gap-2">
                  {files.map(({ fileId, ...item }) => {
                    const isActive = fileId === currentFile?.fileId;
                    return (
                      <button
                        ref={isActive ? activeThumbnailRef : undefined}
                        type="button"
                        className={cn(
                          'shrink-0 cursor-pointer rounded-md border-2 border-transparent',
                          isActive && 'border-solid border-white p-0'
                        )}
                        key={fileId}
                        aria-current={isActive ? 'true' : undefined}
                        aria-label={item.name}
                        onClick={() => {
                          if (!isActive) {
                            openPreview(fileId);
                          }
                        }}
                      >
                        <Thumb {...{ ...item, fileId }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
