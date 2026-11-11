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
import type { PaletteEntry, PaletteResultGroup } from './palette-types';

export type PalettePage = 'appearance' | 'shortcuts' | null;
/** One group of a grouped result list; `status` carries an edition group's loading and errors. */
export interface PaletteGroupView {
  id: string;
  heading?: string;
  entries: PaletteEntry[];
  status?: PaletteResultGroup;
}
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
  /** Set when an edition's group joins the results; `resultEntries` is then their rows in order. */
  groups?: PaletteGroupView[];
  scopes?: { id: string; label: string }[];
  /** Which list the scroll pages: the resources, the edition's group, or neither. */
  paging?: 'resources' | 'extra';
  /** An edition group's own scope is on show: the resources' state stays out of it. */
  inGroupScope?: boolean;
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

/** Found text with its match drawn apart; offsets outside the text draw it plain. */
const Snippet = ({ snippet }: { snippet: NonNullable<PaletteEntry['snippet']> }) => {
  const { text, matchOffset, matchLength } = snippet;
  if (matchOffset < 0 || matchLength <= 0 || matchOffset + matchLength > text.length) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, matchOffset)}
      <mark className="bg-transparent font-semibold text-foreground">
        {text.slice(matchOffset, matchOffset + matchLength)}
      </mark>
      {text.slice(matchOffset + matchLength)}
    </>
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
  const enter = checked ? (
    <Check className="size-4" />
  ) : (
    <CornerDownLeft className="size-3.5 shrink-0 opacity-0 group-aria-selected:opacity-70" />
  );
  if (entry.variant === 'sub') {
    return (
      <CommandItem
        value={entry.id}
        onSelect={() => onRun(entry)}
        className="group flex min-h-8 gap-3 rounded-md py-1.5 pe-3 ps-11 aria-selected:bg-accent"
      >
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {entry.snippet ? <Snippet snippet={entry.snippet} /> : entry.label}
        </span>
        {entry.meta && <span className="shrink-0 text-xs text-muted-foreground">{entry.meta}</span>}
        {enter}
      </CommandItem>
    );
  }
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
        <span className="flex items-baseline gap-2">
          <span className="block min-w-0 flex-1 truncate text-sm">
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
          {entry.meta && (
            <span className="shrink-0 text-xs text-muted-foreground">{entry.meta}</span>
          )}
        </span>
        {entry.description && (
          <span className="block truncate text-xs text-muted-foreground">{entry.description}</span>
        )}
        {entry.snippet && (
          <span className="block truncate text-xs text-muted-foreground">
            <Snippet snippet={entry.snippet} />
          </span>
        )}
      </span>
      {enter}
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
/** An edition group's own state under its rows: still searching, failed, or older on request. */
const PaletteGroupStatus = ({
  status,
  paged,
}: {
  status: NonNullable<PaletteGroupView['status']>;
  paged: boolean;
}) => {
  const { t } = useTranslation('common');
  if (status.error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <span>{t('commandPalette.searchFailed')}</span>
        <Button variant="ghost" size="xs" onClick={status.retry}>
          {t('commandPalette.retry')}
        </Button>
      </div>
    );
  }
  if (status.isLoading) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3 animate-spin" />
        {t('commandPalette.loading')}
      </div>
    );
  }
  if (paged && status.olderOnRequest && status.hasNextPage) {
    return (
      <Button
        variant="ghost"
        size="xs"
        className="mx-3 my-1 text-xs"
        onClick={status.fetchNextPage}
      >
        {t('commandPalette.loadOlder')}
      </Button>
    );
  }
  return null;
};

const PaletteGroups = ({
  model,
  groups,
  onRun,
  isLoading,
}: Pick<PaletteResultsProps, 'model' | 'onRun' | 'isLoading'> & { groups: PaletteGroupView[] }) => {
  const { t } = useTranslation('common');
  // A kind's tab stays on show with nothing in it.
  const emptyKind = groups.length === 1 && !groups[0].entries.length && !groups[0].status;
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
      {emptyKind && !isLoading && (
        <p className="px-3 py-5 text-sm" role="status">
          {t('commandPalette.noResults', { query: model.query })}
        </p>
      )}
      {groups.map((group) => (
        <CommandGroup key={group.id} heading={group.heading}>
          {group.entries.map((entry) => (
            <PaletteRow
              key={entry.id}
              entry={entry}
              query={model.query}
              checked={false}
              onRun={onRun}
            />
          ))}
          {group.status && (
            <PaletteGroupStatus status={group.status} paged={model.paging === 'extra'} />
          )}
        </CommandGroup>
      ))}
    </>
  );
};

const PaletteMatches = ({
  model,
  page,
  onRun,
  isLoading,
}: Pick<PaletteResultsProps, 'model' | 'page' | 'onRun' | 'isLoading'>) => {
  const { t } = useTranslation('common');
  const { theme } = useTheme();
  if (model.groups) {
    return (
      <PaletteGroups model={model} groups={model.groups} onRun={onRun} isLoading={isLoading} />
    );
  }
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
/** The scopes of a grouped search: all, each kind whose feature is on, and each edition group. */
export const PaletteScopes = ({
  model,
  scope,
  onScopeChange,
}: {
  model: PaletteResultModel;
  scope: string;
  onScopeChange: (scope: string) => void;
}) => {
  if (!model.scopes) return null;
  return (
    <div
      role="tablist"
      className="flex items-center gap-1 overflow-x-auto border-b px-3 py-1.5 [scrollbar-width:none]"
    >
      {model.scopes.map((item) => (
        <Button
          key={item.id}
          role="tab"
          aria-selected={item.id === scope}
          variant="ghost"
          size="xs"
          className="h-7 shrink-0 px-2.5 text-xs text-muted-foreground aria-selected:bg-accent aria-selected:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onScopeChange(item.id)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
};

export const PaletteResults = (props: PaletteResultsProps) => {
  const { model, page } = props;
  const { t } = useTranslation('common');
  if (page === 'shortcuts') return <PaletteShortcuts />;
  const extraStatus = model.groups?.find((group) => group.status)?.status;
  let paging: { hasNextPage?: boolean; fetchNextPage?: () => void } = props;
  if (model.groups) {
    if (model.paging === 'extra' && extraStatus && !extraStatus.olderOnRequest) {
      paging = extraStatus;
    } else if (model.paging !== 'resources') {
      paging = {};
    }
  }
  return (
    <CommandList
      className="max-h-[min(58vh,460px)] p-2"
      onScroll={(event) => {
        const list = event.currentTarget;
        if (
          paging.hasNextPage &&
          !model.commandMode &&
          model.query &&
          list.scrollHeight - list.scrollTop - list.clientHeight < 100
        )
          paging.fetchNextPage?.();
      }}
    >
      {model.empty ? (
        <PaletteEmpty model={model} onRun={props.onRun} />
      ) : (
        <PaletteMatches model={model} page={page} onRun={props.onRun} isLoading={props.isLoading} />
      )}
      {props.isLoading && !model.commandMode && !model.inGroupScope && (
        <div
          role="status"
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3 animate-spin" />
          {t('commandPalette.loading')}
        </div>
      )}
      {props.error && !model.commandMode && !model.inGroupScope && (
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
  if (selected?.actionLabel) action = selected.actionLabel;
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
