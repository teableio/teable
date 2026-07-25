import type { Meta, StoryObj } from '@storybook/react';
import { ThemeProvider } from '@teable/next-themes';
import { Bell, CheckCircle2, Loader2, Play, RotateCcw, Trash2, XCircle } from 'lucide-react';
import * as React from 'react';
import type { ExternalToast, ToasterProps } from 'sonner';
import { Button } from './button';
import { Toaster, toast } from './sonner';

type Position = NonNullable<ToasterProps['position']>;
type Theme = NonNullable<ToasterProps['theme']>;
type Dir = NonNullable<ToasterProps['dir']>;
type ToastMethod = 'default' | 'success' | 'info' | 'warning' | 'error' | 'loading' | 'message';
type ToastKind = ToastMethod | 'promise-success' | 'promise-error';
type ContentPreset = 'normal' | 'short' | 'long' | 'empty' | 'bilingual' | 'unbroken';
type StoryVariant = 'basic' | 'state' | 'boundary' | 'bilingual' | 'responsive' | 'interactive';

interface SonnerStoryArgs {
  variant: StoryVariant;
  position: Position;
  theme: Theme;
  richColors: boolean;
  expand: boolean;
  closeButton: boolean;
  visibleToasts: number;
  duration: number;
  gap: number;
  dir: Dir;
  toastKind: ToastKind;
  contentPreset: ContentPreset;
}

interface ToastScenario {
  id: string;
  method: ToastMethod;
  title: React.ReactNode;
  description?: React.ReactNode;
  actionLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  position?: Position;
  dismissible?: boolean;
  mode?: 'single' | 'stack' | 'loading-success' | 'loading-error' | 'empty';
}

interface PresetContent {
  title: string;
  description?: string;
  actionLabel: string;
}

const positions: Position[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

const toastMethods: ToastMethod[] = [
  'default',
  'success',
  'info',
  'warning',
  'error',
  'loading',
  'message',
];

const toastKinds: ToastKind[] = [...toastMethods, 'promise-success', 'promise-error'];

const longEnglish =
  'The scheduled import finished with 128 updated rows, 12 skipped attachments, and 3 fields that require manual review because their formulas reference archived collaborators. The warning remains visible so reviewers can check wrapping, button alignment, and the scrollable description area before dismissing the toast.';

const longChinese =
  '自动化运行完成，已更新 128 条记录，跳过 12 个附件，并发现 3 个字段需要人工复核，因为公式引用了已归档的协作者。该提示会保留较长描述，用于检查中文换行、按钮对齐以及描述区域滚动是否稳定。';

const longMixed =
  '同步完成 Sync completed: 已处理 128 rows，跳过 skipped attachments 12 个，field mapping 需要管理员确认。This mixed-language notification checks wrapping, spacing, and action alignment across English tokens and Chinese copy.';

const unbrokenText =
  'customer-upload-prod-2026-07-06T09:30:00Z-file-preview-super-long-token-without-spaces-8f4c7a1d9e2b5c0a6f3d';

const noop = () => undefined;

const contentPresets: Record<ContentPreset, PresetContent> = {
  normal: {
    title: 'View saved',
    description: 'All collaborators can see the latest view configuration.',
    actionLabel: 'Open',
  },
  short: {
    title: 'Saved',
    description: 'Done.',
    actionLabel: 'View',
  },
  long: {
    title: 'Import finished with warnings',
    description: longEnglish,
    actionLabel: 'Review warnings',
  },
  empty: {
    title: '',
    description: '',
    actionLabel: 'Retry',
  },
  bilingual: {
    title: '发布完成 Publish complete',
    description: longMixed,
    actionLabel: '查看 View',
  },
  unbroken: {
    title: unbrokenText,
    description: `Source: ${unbrokenText}`,
    actionLabel: 'Inspect',
  },
};

const basicScenarios: ToastScenario[] = [
  {
    id: 'basic-default',
    method: 'default',
    title: 'Default toast',
    description: 'A neutral notification with standard foreground and popover colors.',
  },
  {
    id: 'basic-success',
    method: 'success',
    title: 'Base duplicated',
    description: 'The new base is ready.',
  },
  {
    id: 'basic-info',
    method: 'info',
    title: 'Sync queued',
    description: 'The next run starts after current table updates finish.',
  },
  {
    id: 'basic-warning',
    method: 'warning',
    title: 'Quota almost full',
    description: 'Only 8% storage remains in this workspace.',
  },
  {
    id: 'basic-error',
    method: 'error',
    title: 'Upload failed',
    description: 'The attachment service rejected the file checksum.',
  },
  {
    id: 'basic-loading',
    method: 'loading',
    title: 'Publishing app',
    description: 'Generating static assets and warming the preview cache.',
  },
  {
    id: 'basic-message',
    method: 'message',
    title: 'New comment',
    description: 'A teammate mentioned you in the Project tracker.',
  },
  {
    id: 'basic-action',
    method: 'success',
    title: 'Invite sent',
    description: 'The guest can join after accepting the email invitation.',
    actionLabel: 'Copy link',
    cancelLabel: 'Close',
  },
];

const stateScenarios: ToastScenario[] = [
  {
    id: 'state-default',
    method: 'default',
    title: 'Default state',
    description: 'Single toast with close button and standard duration.',
  },
  {
    id: 'state-hover-like',
    method: 'info',
    title: 'Hover-like expanded stack',
    description: 'The story enables expand to expose stacked toast spacing.',
    mode: 'stack',
  },
  {
    id: 'state-loading-success',
    method: 'loading',
    title: 'Saving view settings',
    description: 'This fixed id toast updates from loading to success.',
    mode: 'loading-success',
  },
  {
    id: 'state-loading-error',
    method: 'loading',
    title: 'Publishing automation',
    description: 'This fixed id toast updates from loading to error.',
    mode: 'loading-error',
  },
  {
    id: 'state-disabled-like',
    method: 'warning',
    title: 'Readonly mode',
    description: 'Guest users can inspect this notification but have no action button.',
    dismissible: false,
  },
  {
    id: 'state-error',
    method: 'error',
    title: 'Permission denied',
    description: 'Only admins can run this operation.',
  },
  {
    id: 'state-empty',
    method: 'message',
    title: 'Empty stack',
    description: 'Use Show empty stack to dismiss every toast and inspect an idle Toaster.',
    mode: 'empty',
  },
];

const boundaryScenarios: ToastScenario[] = [
  {
    id: 'boundary-empty-title',
    method: 'message',
    title: '',
    description: 'Description only: title is intentionally empty.',
    actionLabel: 'Details',
  },
  {
    id: 'boundary-empty-description',
    method: 'success',
    title: 'Title only',
  },
  {
    id: 'boundary-short',
    method: 'default',
    title: 'OK',
    description: 'Done.',
  },
  {
    id: 'boundary-long',
    method: 'warning',
    title: 'Long import warning',
    description: longEnglish,
    actionLabel: 'Review',
  },
  {
    id: 'boundary-unbroken',
    method: 'info',
    title: unbrokenText,
    description: `Attachment key: ${unbrokenText}`,
    actionLabel: 'Inspect',
  },
  {
    id: 'boundary-multiline',
    method: 'error',
    title: 'Validation failed',
    description: (
      <span className="whitespace-pre-line">
        {
          'Line 12: required field is empty\nLine 28: formula references a deleted field\nLine 42: lookup target is missing'
        }
      </span>
    ),
  },
  {
    id: 'boundary-action-cancel',
    method: 'warning',
    title: 'Replace existing file?',
    description: 'The destination already contains a file with this name.',
    actionLabel: 'Replace',
    cancelLabel: 'Keep both',
  },
];

const bilingualScenarios: ToastScenario[] = [
  {
    id: 'bilingual-en-normal',
    method: 'success',
    title: 'View saved',
    description: 'All collaborators can see the latest field layout.',
    actionLabel: 'Open view',
  },
  {
    id: 'bilingual-en-short',
    method: 'default',
    title: 'Saved',
    description: 'Done.',
    actionLabel: 'Open',
  },
  {
    id: 'bilingual-en-long',
    method: 'warning',
    title: 'Import finished with warnings',
    description: longEnglish,
    actionLabel: 'Review warnings',
  },
  {
    id: 'bilingual-zh-normal',
    method: 'success',
    title: '视图已保存',
    description: '所有协作者都可以看到最新的字段布局。',
    actionLabel: '打开视图',
  },
  {
    id: 'bilingual-zh-short',
    method: 'default',
    title: '已保存',
    description: '完成。',
    actionLabel: '打开',
  },
  {
    id: 'bilingual-zh-long',
    method: 'warning',
    title: '导入完成，但有警告',
    description: longChinese,
    actionLabel: '查看警告',
  },
  {
    id: 'bilingual-mixed-normal',
    method: 'info',
    title: '发布完成 Publish complete',
    description: '生产环境 Production 已同步到最新版本。',
    actionLabel: '查看 View',
  },
  {
    id: 'bilingual-mixed-short',
    method: 'message',
    title: 'Done 完成',
    description: 'OK。',
    actionLabel: 'Open 打开',
  },
  {
    id: 'bilingual-mixed-long',
    method: 'error',
    title: '同步失败 Sync failed',
    description: longMixed,
    actionLabel: '重试 Retry',
    cancelLabel: '关闭 Close',
  },
];

const responsiveScenarios: ToastScenario[] = [
  {
    id: 'responsive-top-left',
    method: 'success',
    title: 'Top left',
    description: 'Compact notification for narrow side panels.',
    position: 'top-left',
  },
  {
    id: 'responsive-top-center',
    method: 'info',
    title: 'Top center',
    description: 'Default app-level notification placement.',
    position: 'top-center',
  },
  {
    id: 'responsive-top-right',
    method: 'warning',
    title: 'Top right',
    description: longEnglish,
    position: 'top-right',
  },
  {
    id: 'responsive-bottom-left',
    method: 'message',
    title: 'Bottom left',
    description: 'Low-priority message near secondary navigation.',
    position: 'bottom-left',
  },
  {
    id: 'responsive-bottom-center',
    method: 'loading',
    title: 'Bottom center',
    description: 'Persistent loading state.',
    position: 'bottom-center',
  },
  {
    id: 'responsive-bottom-right',
    method: 'error',
    title: 'Bottom right',
    description: unbrokenText,
    position: 'bottom-right',
  },
];

const groupedScenarios: Record<StoryVariant, ToastScenario[]> = {
  basic: basicScenarios,
  state: stateScenarios,
  boundary: boundaryScenarios,
  bilingual: bilingualScenarios,
  responsive: responsiveScenarios,
  interactive: [],
};

const storyLabels: Record<StoryVariant, { title: string; description: string }> = {
  basic: {
    title: '基础展示',
    description: '覆盖 Sonner 常用 toast 类型、action、cancel、closeButton。',
  },
  state: {
    title: '状态展示',
    description: '覆盖默认、展开堆叠、loading 更新、disabled-like、error、empty stack。',
  },
  boundary: {
    title: '边界情况',
    description: '覆盖空值、短文本、长文本、无空格字段、多行错误、action/cancel 组合。',
  },
  bilingual: {
    title: '中英文排版',
    description:
      '分别检查英文、中文、中英混排在正常、短文本、长文本下的 title/description/action。',
  },
  responsive: {
    title: '响应式/布局',
    description: '覆盖紧凑、宽屏、窄屏容器说明，以及 top/bottom + left/center/right toast 位置。',
  },
  interactive: {
    title: '交互控制区',
    description: '使用 Storybook Controls 切换 Toaster props，并手动触发 mock toast/promise。',
  },
};

const callToast = (method: ToastMethod, title: React.ReactNode, data: ExternalToast) => {
  if (method === 'default') {
    return toast(title, data);
  }
  return toast[method](title, data);
};

const showScenarioToast = (scenario: ToastScenario, duration: number) => {
  const data: ExternalToast = {
    id: scenario.id,
    description: scenario.description,
    duration,
    dismissible: scenario.dismissible,
    position: scenario.position,
    action: scenario.actionLabel
      ? {
          label: scenario.actionLabel,
          onClick: noop,
        }
      : undefined,
    cancel: scenario.cancelLabel
      ? {
          label: scenario.cancelLabel,
          onClick: noop,
        }
      : undefined,
  };

  callToast(scenario.method, scenario.title, data);
};

const showStackScenarioToast = (duration: number) => {
  toast.info('Hover-like expanded stack', {
    id: 'state-stack-info',
    description: 'First toast in the selected expanded stack.',
    duration,
  });
  toast.success('Stack item saved', {
    id: 'state-stack-success',
    description: 'Second toast keeps spacing visible.',
    duration,
  });
  toast.warning('Stack item needs review', {
    id: 'state-stack-warning',
    description: 'Third toast checks expanded hover-like layout.',
    duration,
  });
};

const showStateUpdateToast = (
  scenario: ToastScenario,
  duration: number,
  outcome: 'success' | 'error'
) => {
  toast.loading(scenario.title, {
    id: scenario.id,
    description: scenario.description,
    duration,
  });

  const timeout = window.setTimeout(
    () => {
      if (outcome === 'success') {
        toast.success('View settings saved', {
          id: scenario.id,
          description: 'The same toast id now renders the completed state.',
          duration,
        });
        return;
      }

      toast.error('Automation publish failed', {
        id: scenario.id,
        description: 'The same toast id now renders the error state.',
        duration,
      });
    },
    outcome === 'success' ? 1400 : 1800
  );

  return [timeout];
};

const showScenarioPreview = (scenario: ToastScenario, duration: number) => {
  toast.dismiss();

  if (scenario.mode === 'empty') {
    return [];
  }

  if (scenario.mode === 'stack') {
    showStackScenarioToast(duration);
    return [];
  }

  if (scenario.mode === 'loading-success') {
    return showStateUpdateToast(scenario, duration, 'success');
  }

  if (scenario.mode === 'loading-error') {
    return showStateUpdateToast(scenario, duration, 'error');
  }

  showScenarioToast(scenario, duration);
  return [];
};

const useSelectedScenarioToast = (
  scenario: ToastScenario | undefined,
  duration: number,
  enabled: boolean,
  replayKey: number
) => {
  React.useEffect(() => {
    if (!enabled || !scenario) {
      return () => toast.dismiss();
    }

    const timeouts = showScenarioPreview(scenario, duration);

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      toast.dismiss();
    };
  }, [duration, enabled, replayKey, scenario]);
};

const getScenarioTitle = (scenario: ToastScenario) => scenario.title || '(empty title)';

const getScenarioDescription = (scenario: ToastScenario) =>
  scenario.description || '(empty description)';

const showControlledToast = (args: SonnerStoryArgs) => {
  toast.dismiss();
  const content = contentPresets[args.contentPreset];
  const id = `interactive-${Date.now()}`;
  const data: ExternalToast = {
    id,
    description: content.description,
    duration: args.duration,
    action: content.actionLabel
      ? {
          label: content.actionLabel,
          onClick: noop,
        }
      : undefined,
  };

  if (args.toastKind === 'promise-success' || args.toastKind === 'promise-error') {
    const shouldResolve = args.toastKind === 'promise-success';
    const promise = new Promise<string>((resolve, reject) => {
      window.setTimeout(() => {
        if (shouldResolve) {
          resolve('Mock promise resolved');
        } else {
          reject(new Error('Mock promise rejected'));
        }
      }, 900);
    });

    toast.promise(promise, {
      id,
      loading: content.title || 'Loading mock promise',
      success: `${content.title || 'Mock promise'} succeeded`,
      error: `${content.title || 'Mock promise'} failed`,
      description: content.description,
      duration: args.duration,
    });
    return;
  }

  callToast(args.toastKind, content.title, data);
};

const ScenarioPicker = ({
  scenarios,
  selectedScenario,
  selectedScenarioId,
  onSelect,
  onReplay,
}: {
  scenarios: ToastScenario[];
  selectedScenario?: ToastScenario;
  selectedScenarioId?: string;
  onSelect: (scenarioId: string) => void;
  onReplay: () => void;
}) => {
  if (scenarios.length === 0) {
    return (
      <div className="rounded-md border border-border-high bg-muted/40 p-4 text-sm text-muted-foreground">
        No scenario is mounted until an interactive control triggers one.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        {scenarios.map((scenario) => {
          const selected = scenario.id === selectedScenarioId;
          return (
            <button
              key={scenario.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(scenario.id)}
              className="flex min-h-10 min-w-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 aria-pressed:border-primary aria-pressed:bg-primary/10"
            >
              <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {scenario.method}
              </span>
              <span className="min-w-0 truncate font-medium">{getScenarioTitle(scenario)}</span>
            </button>
          );
        })}
      </div>

      <div className="min-w-0 rounded-md border border-border bg-background p-4">
        {selectedScenario && (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {selectedScenario.method}
              </span>
              <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                {getScenarioTitle(selectedScenario)}
              </span>
            </div>
            <div className="max-h-28 min-w-0 overflow-y-auto break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
              {getScenarioDescription(selectedScenario)}
            </div>
            {(selectedScenario.actionLabel ||
              selectedScenario.cancelLabel ||
              selectedScenario.position ||
              selectedScenario.mode) && (
              <div className="flex min-w-0 flex-wrap gap-2 text-xs text-muted-foreground">
                {selectedScenario.actionLabel && (
                  <span>action: {selectedScenario.actionLabel}</span>
                )}
                {selectedScenario.cancelLabel && (
                  <span>cancel: {selectedScenario.cancelLabel}</span>
                )}
                {selectedScenario.position && <span>position: {selectedScenario.position}</span>}
                {selectedScenario.mode && <span>mode: {selectedScenario.mode}</span>}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={onReplay}>
                <Play className="size-4" />
                Show selected
              </Button>
              <Button variant="ghost" onClick={() => toast.dismiss()}>
                <Trash2 className="size-4" />
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const LayoutSamples = () => (
  <div className="grid grid-cols-1 gap-3 xl:grid-cols-[220px_minmax(0,1fr)_420px]">
    <div className="min-w-0 rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">compact</div>
      <div className="mt-2 truncate text-sm">Narrow panel notification preview</div>
    </div>
    <div className="min-w-0 rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">wide</div>
      <div className="mt-2 truncate text-sm">{longMixed}</div>
    </div>
    <div className="min-w-0 rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">narrow/mobile</div>
      <div className="mt-2 break-words text-sm [overflow-wrap:anywhere]">{unbrokenText}</div>
    </div>
  </div>
);

const InteractivePanel = ({ args }: { args: SonnerStoryArgs }) => (
  <div className="flex flex-wrap gap-2">
    <Button onClick={() => showControlledToast(args)}>
      <Play className="size-4" />
      Trigger selected
    </Button>
    <Button
      variant="secondary"
      onClick={() => {
        toast.dismiss();
        toast.loading('Uploading attachment', {
          id: 'interactive-loading',
          description: 'Mock loading state with a stable toast id.',
          duration: args.duration,
        });
      }}
    >
      <Loader2 className="size-4" />
      Loading
    </Button>
    <Button
      variant="secondary"
      onClick={() =>
        toast.success('Upload finished', {
          id: 'interactive-loading',
          description: 'The loading toast was updated with the same id.',
          duration: args.duration,
        })
      }
    >
      <CheckCircle2 className="size-4" />
      Update success
    </Button>
    <Button
      variant="secondary"
      onClick={() =>
        toast.error('Upload failed', {
          id: 'interactive-loading',
          description: 'The loading toast was updated to error with the same id.',
          duration: args.duration,
        })
      }
    >
      <XCircle className="size-4" />
      Update error
    </Button>
    <Button
      variant="outline"
      onClick={() => {
        toast.dismiss();
        toast.promise(
          new Promise((resolve) => {
            window.setTimeout(resolve, 900);
          }),
          {
            id: 'interactive-promise-success',
            loading: 'Running mock promise',
            success: 'Mock promise resolved',
            error: 'Mock promise rejected',
            description: 'No network request is made.',
            duration: args.duration,
          }
        );
      }}
    >
      <RotateCcw className="size-4" />
      Promise success
    </Button>
    <Button
      variant="outline"
      onClick={() => {
        toast.dismiss();
        toast.promise(
          new Promise((_, reject) => {
            window.setTimeout(() => reject(new Error('Mock failure')), 900);
          }),
          {
            id: 'interactive-promise-error',
            loading: 'Running mock promise',
            success: 'Mock promise resolved',
            error: 'Mock promise rejected',
            description: 'No network request is made.',
            duration: args.duration,
          }
        );
      }}
    >
      <XCircle className="size-4" />
      Promise error
    </Button>
    <Button variant="ghost" onClick={() => toast.dismiss('interactive-loading')}>
      <Trash2 className="size-4" />
      Dismiss current
    </Button>
    <Button variant="ghost" onClick={() => toast.dismiss()}>
      <Trash2 className="size-4" />
      Dismiss all
    </Button>
  </div>
);

const SonnerStory = (args: SonnerStoryArgs) => {
  const scenarios = groupedScenarios[args.variant];
  const labels = storyLabels[args.variant];
  const [selectedScenarioId, setSelectedScenarioId] = React.useState(scenarios[0]?.id);
  const [replayKey, setReplayKey] = React.useState(0);
  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId);

  React.useEffect(() => {
    setSelectedScenarioId(scenarios[0]?.id);
    setReplayKey((key) => key + 1);
  }, [args.variant, scenarios]);

  const replaySelectedScenario = React.useCallback(() => {
    if (!selectedScenario || selectedScenario.mode === 'empty') {
      toast.dismiss();
      return;
    }

    setReplayKey((key) => key + 1);
  }, [selectedScenario]);

  useSelectedScenarioToast(
    selectedScenario,
    args.duration,
    args.variant !== 'interactive',
    replayKey
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={args.theme}
      forcedTheme={args.theme === 'system' ? undefined : args.theme}
      themeColor={{
        light: '#ffffff',
        dark: '#09090b',
      }}
    >
      <div className="min-h-screen bg-background p-5 text-foreground">
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <header className="flex flex-col gap-2 border-b border-border pb-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bell className="size-4" />
              {labels.title}
            </div>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {labels.description}
            </p>
          </header>

          <section className="flex flex-col gap-3">
            <div className="text-sm font-medium">Story scenarios</div>
            <ScenarioPicker
              scenarios={scenarios}
              selectedScenario={selectedScenario}
              selectedScenarioId={selectedScenarioId}
              onSelect={(scenarioId) => {
                setSelectedScenarioId(scenarioId);
                setReplayKey((key) => key + 1);
              }}
              onReplay={replaySelectedScenario}
            />
          </section>

          {args.variant === 'responsive' && (
            <section className="flex flex-col gap-3">
              <div className="text-sm font-medium">Layout samples</div>
              <LayoutSamples />
            </section>
          )}

          <section className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="text-sm font-medium">Interactive controls</div>
            <InteractivePanel args={args} />
          </section>
        </main>
      </div>
      <Toaster
        position={args.position}
        theme={args.theme}
        richColors={args.richColors}
        expand={args.expand}
        closeButton={args.closeButton}
        visibleToasts={args.visibleToasts}
        duration={args.duration}
        gap={args.gap}
        dir={args.dir}
      />
    </ThemeProvider>
  );
};

const defaultArgs: SonnerStoryArgs = {
  variant: 'basic',
  position: 'top-center',
  theme: 'light',
  richColors: true,
  expand: true,
  closeButton: true,
  visibleToasts: 8,
  duration: 1000000,
  gap: 14,
  dir: 'ltr',
  toastKind: 'success',
  contentPreset: 'normal',
};

const meta = {
  title: 'Components/Shadcn UI/Sonner',
  component: SonnerStory,
  parameters: {
    layout: 'fullscreen',
  },
  args: defaultArgs,
  argTypes: {
    variant: {
      table: {
        disable: true,
      },
    },
    position: {
      control: 'select',
      options: positions,
    },
    theme: {
      control: 'inline-radio',
      options: ['light', 'dark', 'system'],
    },
    richColors: {
      control: 'boolean',
    },
    expand: {
      control: 'boolean',
    },
    closeButton: {
      control: 'boolean',
    },
    visibleToasts: {
      control: {
        type: 'range',
        min: 1,
        max: 12,
        step: 1,
      },
    },
    duration: {
      control: {
        type: 'number',
        min: 1000,
        max: 1000000,
        step: 1000,
      },
    },
    gap: {
      control: {
        type: 'range',
        min: 0,
        max: 32,
        step: 1,
      },
    },
    dir: {
      control: 'inline-radio',
      options: ['ltr', 'rtl', 'auto'],
    },
    toastKind: {
      control: 'select',
      options: toastKinds,
    },
    contentPreset: {
      control: 'select',
      options: ['normal', 'short', 'long', 'empty', 'bilingual', 'unbroken'],
    },
  },
} satisfies Meta<typeof SonnerStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const BasicDisplay: Story = {
  args: {
    variant: 'basic',
    visibleToasts: 8,
    expand: true,
  },
};

export const StateDisplay: Story = {
  args: {
    variant: 'state',
    visibleToasts: 6,
    expand: true,
  },
};

export const BoundaryCases: Story = {
  args: {
    variant: 'boundary',
    visibleToasts: 7,
    expand: true,
  },
};

export const BilingualTypography: Story = {
  args: {
    variant: 'bilingual',
    visibleToasts: 9,
    expand: true,
  },
};

export const ResponsiveLayout: Story = {
  args: {
    variant: 'responsive',
    visibleToasts: 6,
    expand: true,
  },
  parameters: {
    viewport: {
      defaultViewport: 'responsive',
    },
  },
};

export const InteractiveControls: Story = {
  args: {
    variant: 'interactive',
    visibleToasts: 4,
    expand: true,
    toastKind: 'success',
    contentPreset: 'normal',
  },
};
