import { LayoutGrid } from '@teable/icons';
import { useTheme } from '@teable/ui-lib';
import {
  Badge,
  Button,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable/ui-lib/shadcn';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CornerDownLeft,
  Keyboard,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { ComponentProps, RefObject } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { useModKeyStr } from '@/features/app/utils/get-mod-key-str';
import type { PaletteEntry } from './palette-types';

export type PalettePage = 'appearance' | 'shortcuts' | null;
export interface PaletteResultModel {
  commandMode: boolean;
  query: string;
  aiMode: boolean;
  empty: boolean;
  noMatches: boolean;
  ai?: PaletteEntry;
  recent: PaletteEntry[];
  quickActions: PaletteEntry[];
  resultEntries: PaletteEntry[];
}

interface PaletteHeaderProps {
  title: string;
  raw: string;
  page: PalettePage;
  model: PaletteResultModel;
  projectName?: string;
  projectIcon?: string;
  aiEnabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onValueChange: (value: string) => void;
  onCompositionStart: ComponentProps<typeof CommandInput>['onCompositionStart'];
  onCompositionEnd: ComponentProps<typeof CommandInput>['onCompositionEnd'];
  onPasteFiles?: (files: File[]) => void;
}
export const PaletteHeader = (props: PaletteHeaderProps) => {
  const { t } = useTranslation('common');
  const { page, model } = props;
  let placeholder = t('commandPalette.placeholder');
  if (props.aiEnabled) placeholder = t('commandPalette.aiPlaceholder');
  if (model.commandMode) placeholder = t('commandPalette.commandsPlaceholder');
  if (page) placeholder = t(`commandPalette.${page}`);
  return (
    <div className="flex items-center border-b px-2">
      {(page || model.commandMode) && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="ms-1 shrink-0"
          aria-label={t('commandPalette.back')}
          onClick={props.onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
      )}
      <CommandInput
        ref={props.inputRef}
        aria-label={props.title}
        containerClassName="h-14 min-w-0 flex-1 border-0 px-3"
        placeholder={placeholder}
        value={page ? placeholder : props.raw}
        readOnly={Boolean(page)}
        onValueChange={props.onValueChange}
        onCompositionStart={props.onCompositionStart}
        onCompositionEnd={props.onCompositionEnd}
        onPaste={(event) => {
          if (!props.onPasteFiles || props.page) return;
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.length) return;
          event.preventDefault();
          props.onPasteFiles(files);
        }}
        endContent={
          <>
            {(model.commandMode || model.aiMode) && (
              <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                {t(model.commandMode ? 'commandPalette.commands' : 'commandPalette.aiMode')}
              </span>
            )}
            {props.projectName && (
              <Badge
                variant="outline"
                title={props.projectName}
                className="hidden max-w-40 shrink-0 items-center gap-1.5 border bg-muted/50 px-2 py-1 font-medium text-muted-foreground sm:inline-flex"
              >
                {props.projectIcon ? (
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    <Emoji emoji={props.projectIcon} size="0.875rem" />
                  </span>
                ) : (
                  <LayoutGrid className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 truncate">{props.projectName}</span>
              </Badge>
            )}
          </>
        }
      />
    </div>
  );
};

const PaletteRow = ({
  entry,
  query,
  checked,
  onRun,
}: {
  entry: PaletteEntry;
  query: string;
  checked: boolean;
  onRun: (entry: PaletteEntry) => void;
}) => {
  const ranges = entry.matchRanges ?? [];
  return (
    <CommandItem
      value={entry.id}
      onSelect={() => onRun(entry)}
      className="group flex min-h-11 gap-3 rounded-md px-3 py-2 aria-selected:bg-accent"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {entry.icon ?? <LayoutGrid className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          {ranges.length ? (
            <>
              {ranges.map(([start, end], index) => (
                <span key={start}>
                  {entry.label.slice(index ? ranges[index - 1][1] : 0, start)}
                  <mark className="bg-accent font-semibold text-accent-foreground">
                    {entry.label.slice(start, end)}
                  </mark>
                </span>
              ))}
              {entry.label.slice(ranges[ranges.length - 1][1])}
            </>
          ) : (
            <span className={query ? 'font-medium' : undefined}>{entry.label}</span>
          )}
        </span>
        {entry.description && (
          <span className="block truncate text-xs text-muted-foreground">{entry.description}</span>
        )}
      </span>
      {checked ? (
        <Check className="size-4" />
      ) : (
        <CornerDownLeft className="size-3.5 shrink-0 opacity-0 group-aria-selected:opacity-70" />
      )}
    </CommandItem>
  );
};

const PaletteShortcuts = () => {
  const { t } = useTranslation('common');
  const modKey = useModKeyStr();
  const shortcuts = [
    [`${modKey} K`, t('commandPalette.toggle')],
    ['↑ ↓', t('commandPalette.select')],
    ['Enter / Tab', t('commandPalette.execute')],
    [`${modKey} Enter`, t('commandPalette.newTab')],
    ['>', t('commandPalette.commands')],
    ['Backspace', t('commandPalette.backspace')],
    ['Esc', t('commandPalette.back')],
  ];
  return (
    <div className="space-y-3 p-5 text-sm">
      {shortcuts.map(([keys, label]) => (
        <div key={keys} className="flex items-center justify-between gap-6">
          <span>{label}</span>
          <kbd className="shrink-0 rounded border px-2 py-1 text-xs text-muted-foreground">
            {keys}
          </kbd>
        </div>
      ))}
    </div>
  );
};

interface PaletteResultsProps {
  model: PaletteResultModel;
  page: PalettePage;
  onRun: (entry: PaletteEntry) => void;
  isLoading?: boolean;
  error?: boolean;
  retry?: () => void;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
}
const PaletteEmpty = ({ model, onRun }: Pick<PaletteResultsProps, 'model' | 'onRun'>) => {
  const { t } = useTranslation('common');
  return (
    <>
      {model.ai && (
        <div className="mb-2">
          <PaletteRow entry={model.ai} query="" checked={false} onRun={onRun} />
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <CommandGroup heading={t('commandPalette.recent')} className="min-w-0">
          {model.recent.length ? (
            model.recent.map((entry) => (
              <PaletteRow key={entry.id} entry={entry} query="" checked={false} onRun={onRun} />
            ))
          ) : (
            <p className="px-3 py-4 text-xs leading-relaxed text-muted-foreground">
              {t('commandPalette.noRecent')}
            </p>
          )}
        </CommandGroup>
        <CommandGroup heading={t('commandPalette.actions')} className="min-w-0 sm:border-s sm:ps-3">
          {model.quickActions.map((entry) => (
            <PaletteRow key={entry.id} entry={entry} query="" checked={false} onRun={onRun} />
          ))}
        </CommandGroup>
      </div>
    </>
  );
};
const PaletteMatches = ({
  model,
  page,
  onRun,
}: Pick<PaletteResultsProps, 'model' | 'page' | 'onRun'>) => {
  const { t } = useTranslation('common');
  const { theme } = useTheme();
  const heading =
    page === 'appearance'
      ? t('commandPalette.appearance')
      : model.commandMode
        ? t('commandPalette.commands')
        : t('commandPalette.results');
  return (
    <>
      {model.noMatches && (
        <div className="px-3 py-5 text-sm" role="status">
          <p>{t('commandPalette.noResults', { query: model.query })}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(model.ai ? 'commandPalette.noResultsHint' : 'commandPalette.noResultsHintWithoutAI')}
          </p>
        </div>
      )}
      <CommandGroup heading={heading}>
        {model.resultEntries.map((entry) => (
          <PaletteRow
            key={entry.id}
            entry={entry}
            query={model.query}
            checked={page === 'appearance' && theme === entry.id}
            onRun={onRun}
          />
        ))}
      </CommandGroup>
    </>
  );
};
export const PaletteResults = (props: PaletteResultsProps) => {
  const { model, page } = props;
  const { t } = useTranslation('common');
  if (page === 'shortcuts') return <PaletteShortcuts />;
  return (
    <CommandList
      className="max-h-[min(58vh,460px)] p-2"
      onScroll={(event) => {
        const list = event.currentTarget;
        if (
          props.hasNextPage &&
          !model.commandMode &&
          model.query &&
          list.scrollHeight - list.scrollTop - list.clientHeight < 100
        )
          props.fetchNextPage?.();
      }}
    >
      {model.empty ? (
        <PaletteEmpty model={model} onRun={props.onRun} />
      ) : (
        <PaletteMatches model={model} page={page} onRun={props.onRun} />
      )}
      {props.isLoading && !model.commandMode && (
        <div
          role="status"
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3 animate-spin" />
          {t('commandPalette.loading')}
        </div>
      )}
      {props.error && !model.commandMode && (
        <div role="alert" className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <span>{t('commandPalette.searchFailed')}</span>
          <Button variant="ghost" size="xs" onClick={props.retry}>
            {t('commandPalette.retry')}
          </Button>
        </div>
      )}
    </CommandList>
  );
};

export const PaletteFooter = ({
  selected,
  canGoBack,
  onCommands,
  onShortcuts,
}: {
  selected?: PaletteEntry;
  canGoBack: boolean;
  onCommands: () => void;
  onShortcuts: () => void;
}) => {
  const { t } = useTranslation('common');
  let action = t('commandPalette.execute');
  if (selected?.href) action = t('commandPalette.open');
  if (selected?.id.startsWith('ask-cuppy')) action = t('commandPalette.askCuppy');
  return (
    <div className="flex min-h-10 items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1 sm:flex">
          <ArrowUp className="size-3" />
          <ArrowDown className="size-3" />
          {t('commandPalette.select')}
        </span>
        <CornerDownLeft className="size-3" />
        <span>{action}</span>
        <kbd className="ms-1 rounded border px-1">Esc</kbd>
        <span>{t(canGoBack ? 'commandPalette.back' : 'commandPalette.close')}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="xs" className="h-6 px-1.5 text-xs" onClick={onCommands}>
          <span aria-hidden>&gt;</span>
          {t('commandPalette.commands')}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-6"
          aria-label={t('commandPalette.shortcuts')}
          onClick={onShortcuts}
        >
          <Keyboard className="size-3.5" />
        </Button>
      </div>
    </div>
  );
};
