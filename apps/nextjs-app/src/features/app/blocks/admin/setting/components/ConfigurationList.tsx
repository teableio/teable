/* eslint-disable @typescript-eslint/no-explicit-any */
import { Check, AlertCircle } from '@teable/icons';
import type { ISettingVo } from '@teable/openapi';
import { cn, Progress } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import type { ReactNode, RefObject } from 'react';
import { useMemo } from 'react';
import { scrollToTarget } from '../utils';

export interface IList {
  title: string;
  key:
    | 'publicOrigin'
    | 'https'
    | 'llmApi'
    | 'aiEnable'
    | 'aiLlmApi'
    | 'aiModelPool'
    | 'aiChatModel'
    | 'app'
    | 'appBuilderEngine'
    | 'appBuilderDomain'
    | 'sandboxVercel'
    | 'email'
    | 'signupVerification'
    | 'secrets';
  anchor?: RefObject<HTMLDivElement | null>;
  /** Replaces the default path/anchor navigation, e.g. to switch a tab on the same page. */
  onNavigate?: () => void;
  values?: Record<string, string>;
  path: string;
  isComplete: boolean;
  isRequired?: boolean;
  /** 'danger' renders an unfinished item as a security warning instead of an empty checkbox. */
  severity?: 'danger';
  /** Extra content under an unfinished item, outside its button (may hold its own controls). */
  details?: ReactNode;
  group?: 'security' | 'system' | 'ai' | 'appBuilder';
}

type IInsecureSecret = NonNullable<ISettingVo['insecureSecrets']>[number];

const InsecureSecretsList = ({ secrets }: { secrets: IInsecureSecret[] }) => {
  const { t } = useTranslation('common');
  return (
    <div className="space-y-1.5 pb-2 pe-2 ps-9 text-xs">
      {(['missing', 'publicDefault'] as const).map((reason) => {
        const envKeys = secrets.filter((s) => s.reason === reason).map((s) => s.envKey);
        if (!envKeys.length) return null;
        return (
          <div key={reason}>
            <div className="text-muted-foreground">
              {t(`admin.configuration.list.secrets.${reason}`)}
            </div>
            <ul className="mt-0.5 space-y-0.5">
              {envKeys.map((envKey) => (
                <li key={envKey} className="break-all font-mono text-foreground">
                  {envKey}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <a
        className="inline-block text-blue-500 hover:underline"
        href={t('admin.configuration.list.secrets.href')}
        target="_blank"
        rel="noreferrer"
      >
        {t('admin.configuration.list.secrets.docsLink')}
      </a>
    </div>
  );
};

/**
 * Checklist entries of the security group, shared by the admin setting pages.
 * Only risks that are present become entries, so a safe instance shows no
 * security group at all.
 * - Open signup without email verification: anyone can register an address
 *   they do not own, including one that was invited by email, whose
 *   pre-created account already carries the invited role.
 * - Server secrets that are unset or still on a public default. The backend
 *   scopes that check to what this edition reads; an older backend that does
 *   not report it yields no entry.
 */
export const useSecurityItems = (
  setting: ISettingVo | undefined,
  signupAnchor?: RefObject<HTMLDivElement | null>
): IList[] => {
  const { t } = useTranslation('common');
  const disallowSignUp = setting?.disallowSignUp;
  const enableEmailVerification = setting?.enableEmailVerification;
  const insecureSecrets = setting?.insecureSecrets;
  return useMemo(() => {
    if (!setting) return [];
    const items: IList[] = [];
    if (!disallowSignUp && !enableEmailVerification) {
      items.push({
        title: t('admin.configuration.list.signupVerification.title'),
        key: 'signupVerification',
        anchor: signupAnchor,
        isRequired: true,
        isComplete: false,
        severity: 'danger',
        group: 'security',
        path: '/admin/setting?anchor=signup',
      });
    }
    if (insecureSecrets?.length) {
      items.push({
        title: t('admin.configuration.list.secrets.title'),
        key: 'secrets',
        values: { total: String(insecureSecrets.length) },
        isRequired: true,
        isComplete: false,
        severity: 'danger',
        details: <InsecureSecretsList secrets={insecureSecrets} />,
        group: 'security',
        path: '/admin/setting',
      });
    }
    return items;
  }, [setting, disallowSignUp, enableEmailVerification, insecureSecrets, signupAnchor, t]);
};

export interface IConfigurationListProps {
  list: IList[];
  appVersion?: string;
  infraVersion?: string;
}

export const ConfigurationList = (props: IConfigurationListProps) => {
  const { list, appVersion, infraVersion } = props;
  const { t } = useTranslation('common');

  const router = useRouter();

  const requiredList = list.filter((item) => item.isRequired !== false);
  const requiredComplete = requiredList.filter((item) => item.isComplete).length;
  const progress = requiredList.length > 0 ? (requiredComplete / requiredList.length) * 100 : 0;
  const allRequiredComplete = requiredList.length > 0 && requiredComplete === requiredList.length;

  const grouped = useMemo(() => {
    // Security first: its entries only exist while a risk is present.
    const groups: Array<{ key: IList['group']; items: IList[] }> = [
      { key: 'security', items: [] },
      { key: 'system', items: [] },
      { key: 'ai', items: [] },
      { key: 'appBuilder', items: [] },
    ];

    // Filter out optional items - they shouldn't appear in the pending configuration list
    const requiredItems = list.filter((item) => item.isRequired !== false);

    for (const item of requiredItems) {
      const g = item.group ?? 'system';
      const group = groups.find((x) => x.key === g) ?? groups.find((x) => x.key === 'system');
      group?.items.push(item);
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
        {(appVersion || infraVersion) && (
          <span className="mt-1 justify-start self-stretch text-xs text-muted-foreground">
            {appVersion && `${t('settings.setting.version')}: ${appVersion}`}
            {appVersion && infraVersion && ' · '}
            {infraVersion && `${t('settings.setting.infraVersion')}: ${infraVersion}`}
          </span>
        )}
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
                  'flex w-full items-start gap-2 rounded-md p-2 text-start transition-colors hover:bg-muted/40',
                  item.isComplete && 'opacity-80'
                )}
                onClick={() => {
                  if (item.onNavigate) {
                    item.onNavigate();
                    return;
                  }
                  const { path } = item;
                  if (path && !path.includes(router.pathname)) {
                    router.push(path);
                  }
                  item.anchor?.current && scrollToTarget(item.anchor.current);
                }}
              >
                {!item.isComplete && item.severity === 'danger' ? (
                  <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
                ) : (
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
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'truncate text-sm font-medium text-foreground',
                        !item.isComplete && item.severity === 'danger' && 'text-destructive'
                      )}
                    >
                      {item.title}
                    </span>
                  </div>

                  <div className="mt-1 break-words text-xs text-muted-foreground">
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
                                if (item.onNavigate) {
                                  item.onNavigate();
                                  return;
                                }
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
                                  if (item.onNavigate) {
                                    item.onNavigate();
                                    return;
                                  }
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
              {!item.isComplete && item.details}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
