import { LaptopIcon } from '@radix-ui/react-icons';
import { Moon, Settings, Sun } from '@teable/icons';
import { useIsAnonymous, useIsReadOnlyPreview } from '@teable/sdk/hooks';
import { useTheme } from '@teable/ui-lib';
import { Keyboard, Sparkles } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useSettingStore } from '@/features/app/components/setting/useSettingStore';
import {
  createPaletteSearchIndex,
  looksLikeNaturalLanguage,
  parsePaletteQuery,
  searchPaletteEntries,
} from './command-palette-utils';
import type { PaletteEntry } from './palette-types';
import type { PalettePage, PaletteResultModel } from './PaletteContentView';

interface PaletteEntriesOptions {
  commands: PaletteEntry[];
  resources: PaletteEntry[];
  recent: PaletteEntry[];
  isLoading?: boolean;
  preserveResourceResults?: boolean;
  onAskAI?: (query: string, files?: File[]) => void;
  makeCreateTable?: (name: string) => PaletteEntry;
  makeSearchTable?: (query: string) => PaletteEntry;
}

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

export const usePaletteEntries = (
  options: PaletteEntriesOptions,
  raw: string,
  page: PalettePage
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
  const matches = useMemo(() => {
    if (!commandMode && options.preserveResourceResults) {
      return [...options.resources, ...searchPaletteEntries(commandIndex, query)];
    }
    return searchPaletteEntries(commandMode ? commandIndex : allIndex, query);
  }, [
    commandMode,
    commandIndex,
    allIndex,
    query,
    options.preserveResourceResults,
    options.resources,
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
  const model = {
    commandMode,
    query,
    ai,
    aiMode,
    empty: !query && !commandMode && !page,
    noMatches: Boolean(query && !matches.length && !options.isLoading && !page && !aiMode),
    recent: options.recent.slice(0, 3),
    quickActions: options.commands.length
      ? options.commands.slice(0, 3)
      : common.commands.filter((entry) => entry.id === 'shortcuts'),
  };
  if (page === 'appearance') return { ...model, resultEntries: common.appearance };
  if (page === 'shortcuts') return { ...model, resultEntries: [] };
  return { ...model, resultEntries: collectResults(model, [...matches, ...suggestions], options) };
};
