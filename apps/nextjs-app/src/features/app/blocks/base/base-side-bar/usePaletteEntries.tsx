import { LaptopIcon } from '@radix-ui/react-icons';
import { Moon, Settings, Sun } from '@teable/icons';
import { useIsAnonymous, useIsReadOnlyPreview } from '@teable/sdk/hooks';
import { useTheme } from '@teable/ui-lib';
import { Keyboard, Search, Sparkles } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useSettingStore } from '@/features/app/components/setting/useSettingStore';
import {
  createPaletteSearchIndex,
  looksLikeNaturalLanguage,
  parsePaletteQuery,
  searchPaletteEntries,
} from './command-palette-utils';
import type { PaletteEntry, PaletteResultGroup } from './palette-types';
import type { PaletteGroupView, PalettePage, PaletteResultModel } from './PaletteContentView';

interface PaletteEntriesOptions {
  commands: PaletteEntry[];
  resources: PaletteEntry[];
  recent: PaletteEntry[];
  isLoading?: boolean;
  preserveResourceResults?: boolean;
  onAskAI?: (query: string, files?: File[]) => void;
  makeCreateTable?: (name: string) => PaletteEntry;
  makeSearchTable?: (query: string) => PaletteEntry;
  /** More resources wait on the server, past those listed. */
  hasNextPage?: boolean;
  /**
   * The kinds whose feature is on, each a scope tab whether or not it has matches; rows of other
   * kinds stay out of the grouped results. Commands get no tab: `>` searches them alone.
   */
  categories?: string[];
  extra?: PaletteResultGroup;
}

export const ALL_SCOPE = 'all';
/** The kind of rows without a category. */
export const COMMAND_CATEGORY = 'command';
/** The kinds' order, as groups and as scope tabs. */
const CATEGORY_ORDER = [
  'base',
  'table',
  'dashboard',
  'workflow',
  'app',
  'routine',
  COMMAND_CATEGORY,
];
/** Rows each group shows in the "all" scope while another group has results too. */
export const GROUP_CAP = 5;

const useCommonCommands = () => {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const setOpen = useSettingStore((state) => state.setOpen);
  const anonymous = useIsAnonymous();
  const readOnly = useIsReadOnlyPreview();
  const commands = useMemo<PaletteEntry[]>(
    () => [
      {
        id: 'appearance',
        label: t('commandPalette.appearance'),
        icon: <Sun className="size-4" />,
        keywords: ['theme', '外观', '主题'],
        page: 'appearance',
      },
      ...(!anonymous && !readOnly
        ? [
            {
              id: 'settings',
              label: t('settings.allSetting'),
              icon: <Settings className="size-4" />,
              keywords: ['settings', '设置'],
              execute: () => setOpen(true),
            },
          ]
        : []),
      {
        id: 'shortcuts',
        label: t('commandPalette.shortcuts'),
        icon: <Keyboard className="size-4" />,
        keywords: ['help', '?', '帮助'],
        page: 'shortcuts',
      },
    ],
    [anonymous, readOnly, setOpen, t]
  );
  const appearance: PaletteEntry[] = [
    {
      id: 'light',
      label: t('settings.setting.light'),
      icon: <Sun className="size-4" />,
      execute: () => theme.setTheme('light'),
    },
    {
      id: 'dark',
      label: t('settings.setting.dark'),
      icon: <Moon className="size-4" />,
      execute: () => theme.setTheme('dark'),
    },
    {
      id: 'system',
      label: t('settings.setting.system'),
      icon: <LaptopIcon className="size-4" />,
      execute: () => theme.setTheme('system'),
    },
  ];
  return { commands, appearance };
};

const collectResults = (
  model: Omit<PaletteResultModel, 'resultEntries'>,
  matches: PaletteEntry[],
  options: PaletteEntriesOptions
) => {
  if (model.empty) return [...(model.ai ? [model.ai] : []), ...model.recent, ...model.quickActions];
  const results = [...matches];
  if (model.noMatches && !model.commandMode) {
    if (options.makeCreateTable) results.push(options.makeCreateTable(model.query));
    if (options.makeSearchTable) results.push(options.makeSearchTable(model.query));
  }
  if (model.ai) {
    if (model.aiMode || model.noMatches) results.unshift(model.ai);
    else results.push(model.ai);
  }
  return results;
};

interface GroupLabels {
  all: string;
  category: (category: string) => string;
  showAll: string;
  searchMore: (scope: string) => string;
}

const categoryOf = (entry: PaletteEntry) => entry.category ?? COMMAND_CATEGORY;

const rank = (category: string) => {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
};

/** The matches split by kind, the kinds in their order. */
const byCategory = (matches: PaletteEntry[]) => {
  const groups = new Map<string, PaletteEntry[]>();
  matches.forEach((entry) => {
    const category = categoryOf(entry);
    const group = groups.get(category);
    if (group) group.push(entry);
    else groups.set(category, [entry]);
  });
  return new Map([...groups].sort(([a], [b]) => rank(a) - rank(b)));
};

type GroupedModel = Pick<
  PaletteResultModel,
  'groups' | 'scopes' | 'paging' | 'inGroupScope' | 'resultEntries'
>;

/** A capped group's first rows, and the way into its scope when it holds more. */
const capGroup = (
  entries: PaletteEntry[],
  capped: boolean,
  more: PaletteEntry,
  hasMore?: boolean
) => {
  if (!capped) return [...entries];
  const shown = entries.slice(0, GROUP_CAP);
  return entries.length > GROUP_CAP || hasMore ? [...shown, more] : shown;
};

/** What to do about a search nothing matched: create a table by that name, or search the table. */
const fallbackEntries = (
  model: Omit<PaletteResultModel, 'resultEntries'>,
  options: PaletteEntriesOptions
) =>
  model.noMatches
    ? [options.makeCreateTable, options.makeSearchTable].flatMap((make) =>
        make ? [make(model.query)] : []
      )
    : [];

/** The edition group has rows, or leads on to more: a page the scan limit cut short can be empty. */
const extraShows = (extra: PaletteResultGroup) =>
  Boolean(extra.entries.length || extra.hasNextPage);

/** The scroll pages the one uncapped group, if there is one. */
const uncappedPaging = (
  capped: boolean,
  extra: PaletteResultGroup
): PaletteResultModel['paging'] => {
  if (capped) return undefined;
  return extraShows(extra) ? 'extra' : 'resources';
};

/**
 * The "all" scope: a group per kind, then the edition's, each capped while another has rows too
 * (only one group with rows has nothing to make room for), the AI entry first when it is the
 * answer, else last.
 */
const allScopeGroups = (
  model: Omit<PaletteResultModel, 'resultEntries'>,
  categories: Map<string, PaletteEntry[]>,
  suggestions: PaletteEntry[],
  options: PaletteEntriesOptions & { extra: PaletteResultGroup },
  labels: GroupLabels
) => {
  const { extra } = options;
  const more = (id: string, heading: string): PaletteEntry => ({
    id: `more:${id}`,
    label: labels.searchMore(heading),
    icon: <Search className="size-4" />,
    scope: id,
    actionLabel: labels.showAll,
  });
  const capped = categories.size + (extraShows(extra) ? 1 : 0) > 1;
  const leadAI = model.ai && (model.aiMode || model.noMatches) ? model.ai : undefined;
  const groups: PaletteGroupView[] = [];
  if (leadAI || suggestions.length) {
    groups.push({ id: 'ai', entries: [...(leadAI ? [leadAI] : []), ...suggestions] });
  }
  categories.forEach((entries, category) => {
    const heading = labels.category(category);
    // Commands are few and have no scope to show the rest in.
    const cap = capped && category !== COMMAND_CATEGORY;
    const shown = capGroup(entries, cap, more(category, heading), options.hasNextPage);
    groups.push({ id: category, heading, entries: shown });
  });
  const fallbacks = fallbackEntries(model, options);
  if (fallbacks.length) groups.push({ id: 'fallback', entries: fallbacks });
  if (extraShows(extra) || extra.isLoading || extra.error) {
    const entries = capGroup(
      extra.entries,
      capped,
      more(extra.id, extra.heading),
      extra.hasNextPage
    );
    groups.push({ id: extra.id, heading: extra.heading, entries, status: extra });
  }
  if (model.ai && !leadAI) groups.push({ id: 'ai-tail', entries: [model.ai] });
  return { groups, paging: uncappedPaging(capped, extra) };
};

/**
 * Results with an edition's group beside them: the "all" scope shows a group per kind and the
 * edition's, each kind's and the edition group's own scope lists it in full.
 */
const groupResults = (
  model: Omit<PaletteResultModel, 'resultEntries'>,
  matches: PaletteEntry[],
  suggestions: PaletteEntry[],
  options: PaletteEntriesOptions & { extra: PaletteResultGroup },
  scope: string,
  labels: GroupLabels
): GroupedModel => {
  const { extra } = options;
  const categories = byCategory(matches);
  const tabs = [...(options.categories ?? [])].sort((a, b) => rank(a) - rank(b));
  const finish = (groups: PaletteGroupView[], paging?: PaletteResultModel['paging']) => ({
    groups,
    scopes: [
      { id: ALL_SCOPE, label: labels.all },
      ...tabs.map((category) => ({ id: category, label: labels.category(category) })),
      { id: extra.id, label: extra.heading },
    ],
    paging,
    inGroupScope: scope === extra.id,
    resultEntries: groups.flatMap((group) => group.entries),
  });
  if (scope === extra.id) {
    return finish([{ id: extra.id, entries: extra.scopeEntries, status: extra }], 'extra');
  }
  if (tabs.includes(scope)) {
    return finish([{ id: scope, entries: categories.get(scope) ?? [] }], 'resources');
  }
  const all = allScopeGroups(model, categories, suggestions, options, labels);
  return finish(all.groups, all.paging);
};

export const usePaletteEntries = (
  options: PaletteEntriesOptions,
  raw: string,
  page: PalettePage,
  scope: string = ALL_SCOPE
): PaletteResultModel => {
  const { t } = useTranslation(['common', 'table']);
  const common = useCommonCommands();
  const { commandMode, query } = parsePaletteQuery(raw);
  const commandEntries = useMemo(
    () => [...options.commands, ...common.commands],
    [options.commands, common.commands]
  );
  const commandIndex = useMemo(() => createPaletteSearchIndex(commandEntries), [commandEntries]);
  const allIndex = useMemo(
    () => createPaletteSearchIndex([...options.resources, ...commandEntries]),
    [options.resources, commandEntries]
  );
  // A grouped search leaves out the kinds whose feature is off.
  const kinds = options.extra ? options.categories : undefined;
  const matches = useMemo(() => {
    const found =
      !commandMode && options.preserveResourceResults
        ? [...options.resources, ...searchPaletteEntries(commandIndex, query)]
        : searchPaletteEntries(commandMode ? commandIndex : allIndex, query);
    return kinds
      ? found.filter((entry) => !entry.category || kinds.includes(entry.category))
      : found;
  }, [
    commandMode,
    commandIndex,
    allIndex,
    query,
    options.preserveResourceResults,
    options.resources,
    kinds,
  ]);
  const ai: PaletteEntry | undefined =
    options.onAskAI && !commandMode
      ? {
          id: 'ask-cuppy',
          label: query ? t('commandPalette.askQuery', { query }) : t('commandPalette.askCuppy'),
          description: t('commandPalette.aiHint'),
          icon: <Sparkles className="size-4" />,
          execute: () => options.onAskAI?.(query),
        }
      : undefined;
  const aiMode = Boolean(ai && looksLikeNaturalLanguage(query));
  const suggestions: PaletteEntry[] = aiMode
    ? [
        t('table:aiChat.suggestions.createDataAnalysis'),
        t('table:aiChat.suggestions.buildMeCRM'),
        t('table:aiChat.suggestions.buildDashboard'),
      ]
        .filter((prompt) => prompt !== query)
        .map((prompt, index) => ({
          id: `ask-cuppy:${index}`,
          label: prompt,
          icon: <Sparkles className="size-4" />,
          execute: () => options.onAskAI?.(prompt),
        }))
    : [];
  // An edition's group joins the results of a typed search, not the commands or a page.
  const extra = query && !commandMode && !page ? options.extra : undefined;
  const model = {
    commandMode,
    query,
    ai,
    aiMode,
    empty: !query && !commandMode && !page,
    noMatches: Boolean(
      query &&
      !matches.length &&
      !options.isLoading &&
      !page &&
      !aiMode &&
      !extra?.entries.length &&
      !extra?.isLoading
    ),
    recent: options.recent.slice(0, 3),
    quickActions: options.commands.length
      ? options.commands.slice(0, 3)
      : common.commands.filter((entry) => entry.id === 'shortcuts'),
  };
  if (page === 'appearance') return { ...model, resultEntries: common.appearance };
  if (page === 'shortcuts') return { ...model, resultEntries: [] };
  if (extra) {
    const categoryLabels: Record<string, string> = {
      base: t('noun.base'),
      table: t('noun.table'),
      view: t('noun.view'),
      dashboard: t('noun.dashboard'),
      workflow: t('noun.automation'),
      app: t('noun.app'),
      routine: t('noun.routine'),
      [COMMAND_CATEGORY]: t('commandPalette.commands'),
    };
    const labels: GroupLabels = {
      all: t('commandPalette.all'),
      category: (category) => categoryLabels[category] ?? category,
      showAll: t('commandPalette.showAll'),
      searchMore: (heading) => t('commandPalette.searchMore', { scope: heading }),
    };
    return {
      ...model,
      ...groupResults(model, matches, suggestions, { ...options, extra }, scope, labels),
    };
  }
  return { ...model, resultEntries: collectResults(model, [...matches, ...suggestions], options) };
};
