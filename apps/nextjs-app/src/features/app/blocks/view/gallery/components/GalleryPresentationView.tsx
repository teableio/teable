import { ChevronLeft, ChevronRight, X } from '@teable/icons';
import { useRecords, useRowCount } from '@teable/sdk/hooks';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tableConfig } from '@/features/i18n/table.config';
import { usePresentationMode } from '../context/PresentationModeContext';
import { useGallery } from '../hooks';
import {
  clampIndex,
  getRecordWindow,
  resolvePresentationKey,
  shouldIgnorePresentationHotkey,
  stepIndex,
} from '../utils/presentation';
import { PresentationSlide } from './PresentationSlide';

export const GalleryPresentationView = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { setPresenting } = usePresentationMode();
  const { recordQuery, displayFields, coverField, isCoverFit, isFieldNameHidden, primaryField } =
    useGallery();
  const rowCount = useRowCount() ?? 0;
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const { skip, take, offset } = getRecordWindow(index);
  const windowQuery = useMemo(
    () => ({
      ...recordQuery,
      skip,
      take,
    }),
    [recordQuery, skip, take]
  );
  const { records } = useRecords(windowQuery);
  const record = records[offset];

  useEffect(() => {
    setIndex((current) => clampIndex(current, rowCount));
  }, [rowCount]);

  const goTo = useCallback(
    (delta: number) => {
      setIndex((current) => stepIndex(current, rowCount, delta));
    },
    [rowCount]
  );

  const exit = useCallback(() => {
    setPresenting(false);
  }, [setPresenting]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    rootRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnorePresentationHotkey(event.target)) return;
      const action = resolvePresentationKey(event);
      if (!action) return;
      event.preventDefault();
      if (action === 'exit') {
        exit();
        return;
      }
      goTo(action === 'next' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exit, goTo]);

  const atStart = index <= 0;
  const atEnd = rowCount === 0 || index >= rowCount - 1;
  const counter =
    rowCount === 0
      ? t('table:gallery.presentation.empty')
      : t('table:gallery.presentation.counter', { current: index + 1, total: rowCount });

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t('table:gallery.toolbar.present')}
      className="fixed inset-0 z-[200] flex flex-col bg-zinc-950 text-zinc-50 outline-none"
    >
      <header className="flex shrink-0 items-center justify-between gap-4 px-6 py-4">
        <p className="text-sm font-medium tracking-wide text-zinc-300">{counter}</p>
        <p className="hidden text-xs text-zinc-400 md:block">
          {t('table:gallery.presentation.keyboardHint')}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="text-zinc-100 hover:bg-white/10 hover:text-white"
          onClick={exit}
        >
          <X className="size-4" />
          {t('table:gallery.presentation.exit')}
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-stretch">
        <Button
          type="button"
          variant="ghost"
          disabled={atStart}
          aria-label={t('table:gallery.presentation.previous')}
          className={cn(
            'absolute start-2 top-1/2 z-10 hidden h-14 w-14 -translate-y-1/2 rounded-full text-zinc-100 hover:bg-white/10 md:inline-flex',
            atStart && 'opacity-30'
          )}
          onClick={() => goTo(-1)}
        >
          <ChevronLeft className="size-8" />
        </Button>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 md:px-24 md:py-4">
          {rowCount === 0 ? (
            <p className="text-2xl text-zinc-400">{t('table:gallery.presentation.empty')}</p>
          ) : (
            <PresentationSlide
              card={record}
              primaryField={primaryField}
              displayFields={displayFields}
              coverField={coverField}
              isCoverFit={isCoverFit}
              isFieldNameHidden={isFieldNameHidden}
            />
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          disabled={atEnd}
          aria-label={t('table:gallery.presentation.next')}
          className={cn(
            'absolute end-2 top-1/2 z-10 hidden h-14 w-14 -translate-y-1/2 rounded-full text-zinc-100 hover:bg-white/10 md:inline-flex',
            atEnd && 'opacity-30'
          )}
          onClick={() => goTo(1)}
        >
          <ChevronRight className="size-8" />
        </Button>
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-3 px-6 py-4 md:hidden">
        <Button
          variant="secondary"
          disabled={atStart}
          onClick={() => goTo(-1)}
          aria-label={t('table:gallery.presentation.previous')}
        >
          <ChevronLeft className="size-4" />
          {t('table:gallery.presentation.previous')}
        </Button>
        <Button
          variant="secondary"
          disabled={atEnd}
          onClick={() => goTo(1)}
          aria-label={t('table:gallery.presentation.next')}
        >
          {t('table:gallery.presentation.next')}
          <ChevronRight className="size-4" />
        </Button>
      </footer>
    </div>,
    document.body
  );
};
