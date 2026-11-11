import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { LayoutGrid } from '@teable/icons';
import { ResourceType, spaceSearch } from '@teable/openapi';
import type { ISpaceSearchVo } from '@teable/openapi';
import { useBase, useBaseId, useTableId } from '@teable/sdk/hooks';
import { Command, Dialog, DialogContent, DialogTitle } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent, RefObject } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { useDisableAIAction } from '@/features/app/hooks/useDisableAIAction';
import { useIsCommunity } from '@/features/app/hooks/useIsCommunity';
import { useSetting } from '@/features/app/hooks/useSetting';
import { getBaseDisplayName } from '@/features/app/utils/base-name';
import { useBaseList } from '../../space/useBaseList';
import { BaseNodeResourceIconMap, getNodeUrl } from '../base-node/hooks';
import { useLastVisitBase } from '../hooks';
import { parsePaletteQuery } from './command-palette-utils';
import type { PaletteEntry, UsePaletteExtraResults } from './palette-types';
import { PaletteHeader, PaletteResults, PaletteFooter, PaletteScopes } from './PaletteContentView';
import type { PalettePage } from './PaletteContentView';
import { ALL_SCOPE, usePaletteEntries } from './usePaletteEntries';
import { usePaletteNavigation } from './usePaletteNavigation';
import { usePaletteProjectActions } from './usePaletteProjectActions';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId?: string;
  /** `files` hands a clipboard attachment to the conversation instead of sending text. */
  onAskAI?: (prompt: string, files?: File[]) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  /** An edition's results beside the resources, searched across the space. */
  useExtraResults?: UsePaletteExtraResults;
}

interface PaletteSurfaceProps extends CommandPaletteProps {
  projectIcon?: string;
  projectName?: string;
  resources: PaletteEntry[];
  recent: PaletteEntry[];
  commands: PaletteEntry[];
  isLoading?: boolean;
  preserveResourceResults?: boolean;
  error?: boolean;
  retry?: () => void;
  onSearchChange?: (query: string) => void;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  makeCreateTable?: (name: string) => PaletteEntry;
  makeSearchTable?: (query: string) => PaletteEntry;
  /** The kinds the search found, when `resources` are one kind's only. */
  categories?: string[];
  onScopeChange?: (scope: string) => void;
}

const EMPTY_ENTRIES: PaletteEntry[] = [];
const noExtraResults: UsePaletteExtraResults = () => undefined;
const resourceIcons: Record<
  string,
  ComponentType<{ className?: string }>
> = BaseNodeResourceIconMap;

const RESOURCE_TYPES = Object.values(ResourceType);

/** The kinds the palette offers a tab for, each while its feature is on; projects only space-wide. */
const usePaletteKinds = (spaceWide: boolean) => {
  const isCommunity = useIsCommunity();
  const { disallowDashboard } = useSetting();
  const { aiChat } = useDisableAIAction();
  return useMemo(
    () => [
      ...(spaceWide ? [ResourceType.Base] : []),
      ResourceType.Table,
      ...(disallowDashboard ? [] : [ResourceType.Dashboard]),
      ...(isCommunity
        ? []
        : [ResourceType.Workflow, ...(aiChat ? [ResourceType.App] : []), ResourceType.Routine]),
    ],
    [spaceWide, disallowDashboard, isCommunity, aiChat]
  );
};

/** The space's resources named like `search`, of one type when `type` is given. */
const useSpaceSearch = (
  spaceId: string | undefined,
  search: string,
  enabled: boolean,
  type?: ResourceType
) =>
  useInfiniteQuery({
    queryKey: ['space-search', spaceId, search, type],
    queryFn: ({ pageParam, signal }) =>
      spaceSearch(spaceId!, { search, type, pageSize: 20, cursor: pageParam }, signal).then(
        (response) => response.data
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && Boolean(spaceId && search),
    // A type's search starts empty: the previous type's rows are no placeholder for it.
    placeholderData: type ? undefined : keepPreviousData,
  });

const toEntries = (data?: InfiniteData<ISpaceSearchVo>) =>
  (data?.pages.flatMap((page) => page.list) ?? []).flatMap((item): PaletteEntry[] => {
    const href = getNodeUrl({
      baseId: item.baseId,
      resourceType: item.type,
      resourceId: item.id,
    })?.pathname;
    if (!href) return [];
    const Icon = resourceIcons[item.type] ?? LayoutGrid;
    return [
      {
        id: `resource:${item.type}:${item.id}`,
        label: item.name,
        description: item.baseName,
        href,
        icon: item.icon ? <Emoji emoji={item.icon} size="1em" /> : <Icon className="size-4" />,
        category: item.type,
      },
    ];
  });

/** Base-only hooks stay below this branch: the space sidebar has no TableProvider. */
export const CommandPalette = (props: CommandPaletteProps) => {
  const baseId = useBaseId();
  return baseId ? (
    <ProjectPalette key={baseId} {...props} baseId={baseId} />
  ) : (
    <SpacePalette key={props.spaceId ?? 'shared'} {...props} />
  );
};

const ProjectPalette = ({ baseId, ...props }: CommandPaletteProps & { baseId: string }) => {
  const base = useBase();
  const { t } = useTranslation('common');
  const tableId = useTableId();
  const router = useRouter();
  const navigation = usePaletteNavigation({ baseId, tableId, open: props.open });
  const onNavigate = useCallback(
    (href: string) => {
      void router.push(href);
    },
    [router]
  );
  const actions = usePaletteProjectActions({ baseId, tableId, onNavigate });
  const categories = usePaletteKinds(false);
  const resources = useMemo(
    () => [...navigation.resources, ...navigation.views],
    [navigation.resources, navigation.views]
  );
  return (
    <>
      <PaletteSurface
        {...props}
        projectName={base ? getBaseDisplayName(base.name, t) : undefined}
        projectIcon={base?.icon ?? undefined}
        resources={resources}
        recent={navigation.recent}
        commands={actions.commands}
        categories={categories}
        isLoading={navigation.isLoading}
        makeCreateTable={actions.makeCreateTable}
        makeSearchTable={actions.makeSearchTable}
      />
      {actions.overlays}
    </>
  );
};

const SpacePalette = (props: CommandPaletteProps) => {
  const { t } = useTranslation('common');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    if (!props.open || !search) {
      setDebounced('');
      return;
    }
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search, props.open]);
  useEffect(() => {
    if (!props.open) setSearch('');
  }, [props.open]);
  const [scope, setScope] = useState(ALL_SCOPE);
  const type = RESOURCE_TYPES.find((item) => item === scope);
  const all = useSpaceSearch(props.spaceId, debounced, props.open);
  const typed = useSpaceSearch(props.spaceId, debounced, props.open && Boolean(type), type);
  // A kind's scope shows the kind's rows the mixed search found until its own search answers.
  const own = type && typed.data ? typed : undefined;
  const query = type ? typed : all;
  const { list: lastVisitBases } = useLastVisitBase(props.open && Boolean(props.spaceId));
  const baseList = useBaseList(props.open && Boolean(props.spaceId));
  const recent = useMemo(() => {
    if (!props.spaceId || !baseList) return EMPTY_ENTRIES;

    const currentSpaceBases = new Map(
      baseList.filter((base) => base.spaceId === props.spaceId).map((base) => [base.id, base])
    );

    return lastVisitBases.flatMap((visitedBase): PaletteEntry[] => {
      const base = currentSpaceBases.get(visitedBase.id);
      if (!base) return [];

      return [
        {
          id: `base:${base.id}`,
          label: getBaseDisplayName(base.name, t),
          href: `/base/${base.id}`,
          icon: base.icon ? (
            <Emoji emoji={base.icon} size="1em" />
          ) : (
            <LayoutGrid className="size-4" />
          ),
        },
      ];
    });
  }, [baseList, lastVisitBases, props.spaceId, t]);
  const allResources = useMemo(() => toEntries(all.data), [all.data]);
  const typedResources = useMemo(() => toEntries(typed.data), [typed.data]);
  const categories = usePaletteKinds(true);
  const resources = own ? typedResources : allResources;
  return (
    <PaletteSurface
      {...props}
      resources={search ? resources : EMPTY_ENTRIES}
      recent={recent}
      commands={EMPTY_ENTRIES}
      categories={categories}
      onSearchChange={setSearch}
      onScopeChange={setScope}
      isLoading={Boolean(search) && (search !== debounced || query.isFetching)}
      preserveResourceResults={search !== debounced || (!own && all.isPlaceholderData)}
      error={query.isError}
      retry={() => {
        void query.refetch();
      }}
      hasNextPage={type ? Boolean(own?.hasNextPage) : all.hasNextPage}
      fetchNextPage={() => {
        if (!query.isFetching && !query.isPlaceholderData) void query.fetchNextPage();
      }}
    />
  );
};
/** An accessible dialog; the content unmounts on every close, including the global shortcut. */
export const PaletteSurface = (props: PaletteSurfaceProps) => {
  const { t } = useTranslation('common');
  const previousFocus = useRef<HTMLElement | null>(null);
  const handingOff = useRef(false);
  useEffect(() => {
    if (props.open) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      handingOff.current = false;
    }
  }, [props.open]);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && (
        <PaletteContent
          {...props}
          onHandoff={() => {
            handingOff.current = true;
          }}
          restoreFocus={() => {
            if (!handingOff.current)
              (props.triggerRef?.current ?? previousFocus.current)?.focus({ preventScroll: true });
          }}
          title={t('commandPalette.title')}
        />
      )}
    </Dialog>
  );
};

interface PaletteContentProps extends PaletteSurfaceProps {
  title: string;
  onHandoff: () => void;
  restoreFocus: () => void;
}

const PaletteContent = (props: PaletteContentProps) => {
  const { t } = useTranslation('common');
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const [page, setPage] = useState<PalettePage>(null);
  const [scope, setScope] = useState(ALL_SCOPE);
  const [selection, setSelection] = useState('');
  const composing = useRef(false);
  const executing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const openedAt = useRef(Date.now());
  const trackedQuery = useRef('');
  const parsed = parsePaletteQuery(raw);
  // Set once per mount by the host, so the hook called here is always the same one.
  const useExtraResults = props.useExtraResults ?? noExtraResults;
  const extra = useExtraResults(parsed.commandMode || page ? '' : parsed.query, props.spaceId);
  const model = usePaletteEntries({ ...props, extra }, raw, page, scope);
  const { commandMode, query, noMatches, resultEntries } = model;
  const extraLoading = Boolean(model.groups && extra?.isLoading);
  const selected = resultEntries.find((entry) => entry.id === selection) ?? resultEntries[0];
  const { onScopeChange } = props;
  useEffect(() => {
    onScopeChange?.(scope);
  }, [onScopeChange, scope]);
  // A kind's tab leaves with its feature, e.g. apps once the AI settings arrive with AI chat off.
  const scopeGone = Boolean(model.scopes?.every((item) => item.id !== scope));
  useEffect(() => {
    if (scopeGone) setScope(ALL_SCOPE);
  }, [scopeGone]);

  useEffect(() => {
    setSelection('');
  }, [raw, page, scope]);
  const extraId = model.groups ? extra?.id : undefined;
  const extraCount = extra?.entries.length ?? 0;
  useEffect(() => {
    if (!query || props.isLoading || extraLoading || trackedQuery.current === query) return;
    const timer = setTimeout(() => {
      trackedQuery.current = query;
      window.posthog?.capture('command_palette_search', {
        entry: props.projectName ? 'project' : 'space',
        zero_result: noMatches,
        query_length: query.length,
        ...(extraId ? { [`${extraId}_results`]: extraCount } : {}),
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [extraCount, extraId, extraLoading, noMatches, props.isLoading, props.projectName, query]);

  const inScope = scope !== ALL_SCOPE && Boolean(model.scopes);
  const goBack = () => {
    if (page) setPage(null);
    else if (inScope) setScope(ALL_SCOPE);
    else setRaw('');
    input.current?.focus();
  };
  const run = (entry: PaletteEntry, newTab = false) => {
    if (composing.current || executing.current) return;
    if (entry.page) {
      setPage(entry.page);
      input.current?.focus();
      return;
    }
    if (entry.scope) {
      setScope(entry.scope);
      input.current?.focus();
      return;
    }
    if (page === 'appearance') {
      entry.execute?.();
      setPage(null);
      return;
    }
    executing.current = true;
    window.posthog?.capture('command_palette_select', {
      entry: props.projectName ? 'project' : 'space',
      kind: entry.href ? 'navigation' : entry.id.startsWith('ask-cuppy') ? 'ai' : 'command',
      time_to_select: Date.now() - openedAt.current,
      command: entry.href ? undefined : entry.id,
      ...entry.analytics,
    });
    props.onHandoff();
    // A real click/key gesture is required for opening a new tab; do not defer this branch.
    if (newTab && entry.href) window.open(entry.href, '_blank', 'noopener,noreferrer');
    props.onOpenChange(false);
    if (newTab && entry.href) return;
    requestAnimationFrame(() => {
      Promise.resolve()
        .then(async () => {
          if (entry.href) await router.push(entry.href);
          else await entry.execute?.();
        })
        .catch(() => toast.error(t('commandPalette.actionFailed')));
    });
  };
  const handoffFiles = (files: File[]) => {
    if (!files.length || !props.onAskAI || executing.current) return;
    executing.current = true;
    window.posthog?.capture('command_palette_select', {
      entry: props.projectName ? 'project' : 'space',
      kind: 'attachment',
      time_to_select: Date.now() - openedAt.current,
    });
    props.onHandoff();
    props.onOpenChange(false);
    props.onAskAI(query, files);
  };
  const handleKeys = (event: KeyboardEvent) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.target !== input.current) return;
    if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      if (selected) run(selected, event.metaKey || event.ctrlKey);
    } else if (event.key === 'Backspace' && commandMode && !query) {
      event.preventDefault();
      setRaw('');
      props.onSearchChange?.('');
    }
  };

  return (
    <DialogContent
      closeable={false}
      className="top-[18vh] w-[calc(100%-2rem)] max-w-[680px] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:w-full"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        input.current?.focus();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        props.restoreFocus();
      }}
      onEscapeKeyDown={(event) => {
        if (composing.current) {
          event.preventDefault();
          return;
        }
        if (page || commandMode || inScope) {
          event.preventDefault();
          goBack();
        }
      }}
      onKeyDownCapture={(event) => {
        // Let the focused button's native Enter click run, not cmdk's selected option.
        if (event.target !== input.current && event.key === 'Enter') {
          event.stopPropagation();
          return;
        }
        handleKeys(event);
      }}
      aria-describedby={undefined}
    >
      <DialogTitle className="sr-only">{props.title}</DialogTitle>
      <Command
        shouldFilter={false}
        loop
        value={selected?.id ?? ''}
        onValueChange={setSelection}
        label={props.title}
      >
        <PaletteHeader
          title={props.title}
          raw={raw}
          page={page}
          model={model}
          projectName={props.projectName}
          projectIcon={props.projectIcon}
          onPasteFiles={props.onAskAI ? handoffFiles : undefined}
          aiEnabled={Boolean(props.onAskAI)}
          inputRef={input}
          onBack={goBack}
          onValueChange={(value) => {
            if (value === '?') {
              setPage('shortcuts');
              return;
            }
            setRaw(value);
            if (!value) setScope(ALL_SCOPE);
            if (!composing.current) {
              const parsed = parsePaletteQuery(value);
              props.onSearchChange?.(parsed.commandMode ? '' : parsed.query);
            }
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            const parsed = parsePaletteQuery(event.currentTarget.value);
            props.onSearchChange?.(parsed.commandMode ? '' : parsed.query);
          }}
        />
        <PaletteScopes
          model={model}
          scope={scope}
          onScopeChange={(next) => {
            setScope(next);
            input.current?.focus();
          }}
        />
        <PaletteResults
          model={model}
          page={page}
          onRun={run}
          isLoading={props.isLoading}
          error={props.error}
          retry={props.retry}
          hasNextPage={props.hasNextPage}
          fetchNextPage={props.fetchNextPage}
        />
        <PaletteFooter
          selected={selected}
          canGoBack={Boolean(page || commandMode || inScope)}
          onCommands={() => {
            setRaw('>');
            props.onSearchChange?.('');
            setPage(null);
            input.current?.focus();
          }}
          onShortcuts={() => setPage('shortcuts')}
        />
      </Command>
    </DialogContent>
  );
};
