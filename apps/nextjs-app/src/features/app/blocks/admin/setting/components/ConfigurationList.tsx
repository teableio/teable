/* eslint-disable @typescript-eslint/no-explicit-any */
import { Check, AlertCircle } from '@teable/icons';
import { cn, Progress } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import type { RefObject } from 'react';
import { useMemo } from 'react';
import { scrollToTarget } from '../utils';

export interface IList {
  title: string;
  key:
    | 'publicOrigin'
    | 'https'
    | 'databaseProxy'
    | 'llmApi'
    | 'aiEnable'
    | 'aiLlmApi'
    | 'aiModelPool'
    | 'aiChatModel'
    | 'app'
    | 'appBuilderV0'
    | 'appBuilderDomain'
    | 'appBuilderApiProxy'
    | 'email';
  anchor?: RefObject<HTMLDivElement>;
  values?: Record<string, string>;
  path: string;
  isComplete: boolean;
  isRequired?: boolean;
  group?: 'system' | 'ai' | 'appBuilder';
}

export interface IConfigurationListProps {
  list: IList[];
}

export const ConfigurationList = (props: IConfigurationListProps) => {
  const { list } = props;
  const { t } = useTranslation('common');

  const router = useRouter();

  const requiredList = list.filter((item) => item.isRequired !== false);
  const requiredComplete = requiredList.filter((item) => item.isComplete).length;
  const progress = requiredList.length > 0 ? (requiredComplete / requiredList.length) * 100 : 0;
  const allRequiredComplete = requiredList.length > 0 && requiredComplete === requiredList.length;

  const grouped = useMemo(() => {
    const groups: Array<{ key: IList['group']; items: IList[] }> = [
      { key: 'system', items: [] },
      { key: 'ai', items: [] },
      { key: 'appBuilder', items: [] },
    ];

    // Filter out optional items - they shouldn't appear in the pending configuration list
    const requiredItems = list.filter((item) => item.isRequired !== false);

    for (const item of requiredItems) {
      const g = item.group ?? 'system';
      const group = groups.find((x) => x.key === g);
      (group?.items ?? groups[0].items).push(item);
    }

    return groups.filter((g) => g.items.length > 0);
  }, [list]);

  return (
    <div className="flex h-44 w-full min-w-full flex-col space-y-4 overflow-y-auto rounded-lg border bg-secondary p-4 sm:h-auto sm:max-h-[80vh] sm:w-[360px] sm:min-w-[360px]">
      <div className="flex flex-col">
        <span className="mb-1 justify-start self-stretch text-base font-semibold text-foreground">
          {t('admin.configuration.title')}
        </span>
        <span className="justify-start self-stretch text-xs text-muted-foreground">
          {t('admin.configuration.description')}
        </span>
      </div>

      {/* Progress */}
      {requiredList.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">
              {t('admin.configuration.progressTitle', '配置进度')}
            </span>
            <span className="text-xs text-muted-foreground">
              {requiredComplete}/{requiredList.length}
            </span>
          </div>
          <Progress value={progress} className="h-2" />

          <div
            className={cn(
              'mt-3 flex items-start gap-2 rounded-md p-2 text-xs',
              allRequiredComplete
                ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
            )}
          >
            {allRequiredComplete ? (
              <Check className="mt-0.5 size-3 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
            )}
            <span>
              {allRequiredComplete
                ? t('admin.configuration.allComplete', '所有配置已完成')
                : t('admin.configuration.incomplete', '还有配置未完成')}
            </span>
          </div>
        </div>
      )}

      {/* Grouped checklist */}
      {grouped.map((group: { key: IList['group']; items: IList[] }) => (
        <div key={group.key ?? 'system'} className="space-y-1">
          <div className="px-2 text-xs font-medium text-muted-foreground">
            {t(`admin.configuration.group.${group.key ?? 'system'}` as any)}
          </div>
          {group.items.map((item: IList) => (
            <div key={`${group.key}-${item.title}`} className="flex flex-col">
              <button
                type="button"
                className={cn(
                  'flex w-full items-start gap-2 rounded-md p-2 text-left transition-colors hover:bg-muted/40',
                  item.isComplete && 'opacity-80'
                )}
                onClick={() => {
                  const { path } = item;
                  if (path && !path.includes(router.pathname)) {
                    router.push(path);
                  }
                  item.anchor?.current && scrollToTarget(item.anchor.current);
                }}
              >
                <div
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                    item.isComplete
                      ? 'bg-green-500 text-white'
                      : 'border-2 border-muted-foreground/30'
                  )}
                >
                  {item.isComplete ? <Check className="size-3" /> : null}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                  </div>

                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.isComplete ? (
                      <span>{t('admin.configuration.completed', '已完成')}</span>
                    ) : (
                      <Trans
                        ns="common"
                        i18nKey={`admin.configuration.list.${item.key}.description` as any}
                        values={item.values ?? undefined}
                        components={{
                          anchor: (
                            <span
                              className="cursor-pointer text-blue-500"
                              onClick={(e) => {
                                e.preventDefault();
                                const { path } = item;
                                if (path && !path.includes(router.pathname)) {
                                  router.push(path);
                                }
                                item.anchor?.current && scrollToTarget(item.anchor.current);
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  const { path } = item;
                                  if (path && !path.includes(router.pathname)) {
                                    router.push(path);
                                  }
                                  item.anchor?.current && scrollToTarget(item.anchor.current);
                                }
                              }}
                            />
                          ),
                          strong: <span className="font-bold" />,
                          underline: <span className="underline" />,
                          a: (
                            <Link
                              className="cursor-pointer text-blue-500"
                              href={t(`admin.configuration.list.${item.key}.href` as any) as any}
                              target="_blank"
                              rel="noreferrer"
                            />
                          ),
                        }}
                      />
                    )}
                  </div>
                </div>
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
