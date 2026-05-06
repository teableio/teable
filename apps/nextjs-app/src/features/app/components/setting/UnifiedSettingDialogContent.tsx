import { useQuery } from '@tanstack/react-query';
import { Role } from '@teable/core';
import { Bell, Key, Link, Lock, Settings, User } from '@teable/icons';
import { getSpaceById } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase, useSession } from '@teable/sdk/hooks';
import { Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@teable/ui-lib/shadcn';
import { uniq } from 'lodash';
import { Settings2, Users } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useTranslation } from 'next-i18next';
import type { ElementType, ReactElement, ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import { CollaboratorPage } from '@/features/app/blocks/space-setting/collaborator';
import { GeneralPage } from '@/features/app/blocks/space-setting/general';
import { SpaceSettingTab } from '@/features/app/blocks/space-setting/types';
import { Account } from '@/features/app/components/setting/Account';
import { Integration } from '@/features/app/components/setting/integration/Integration';
import { Notifications } from '@/features/app/components/setting/Notifications';
import { OAuthAppSection } from '@/features/app/components/setting/oauth-app';
import { PersonalAccessTokenSection } from '@/features/app/components/setting/personal-access-token';
import { System } from '@/features/app/components/setting/System';
import { SettingTab as PersonalSettingTab } from '@/features/app/components/setting/useSettingStore';
import { SpaceAvatar } from '@/features/app/components/space/SpaceAvatar';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { settingConfig } from '@/features/i18n/setting.config';
import { spaceConfig } from '@/features/i18n/space.config';

export type UnifiedSettingKnownTab = PersonalSettingTab | SpaceSettingTab;
export type UnifiedSettingTab = string;

export interface IUnifiedSettingListItem {
  key: UnifiedSettingTab;
  name: string;
  Icon: ElementType;
  badge?: ReactNode;
  disabled?: boolean;
  content: ReactNode | ((ctx: IUnifiedSettingRenderContext) => ReactNode);
  contentClassName?: string;
}

export interface IUnifiedSettingRenderContext {
  onTabChange: (tab: UnifiedSettingTab) => void;
  resolvedSpaceId?: string;
  showSidebar: boolean;
}

export interface IUnifiedSettingTriggerOverrides {
  badge?: ReactNode;
  disabled?: boolean;
}

interface IUnifiedSettingGroup {
  key: 'personal' | 'space';
  title: string;
  entity: ReactNode;
  tabs: IUnifiedSettingListItem[];
}

export interface IUnifiedSettingDialogContentProps {
  tab: UnifiedSettingTab;
  onTabChange: (tab: UnifiedSettingTab) => void;
  entry: 'personal' | 'space';
  defaultTab: UnifiedSettingTab;
  contentOnly?: boolean;
  spaceId?: string;
  includeSpaceSettings?: boolean;
  extraPersonalTabs?: IUnifiedSettingListItem[];
  extraSpaceTabs?: IUnifiedSettingListItem[];
  renderTabTrigger?: (
    item: IUnifiedSettingListItem,
    ctx: IUnifiedSettingRenderContext,
    renderDefaultTrigger: (overrides?: IUnifiedSettingTriggerOverrides) => ReactElement
  ) => ReactElement;
}

export const UnifiedSettingDialogContent = ({
  tab,
  onTabChange,
  entry,
  defaultTab,
  contentOnly = false,
  spaceId: spaceIdProp,
  includeSpaceSettings = true,
  extraPersonalTabs,
  extraSpaceTabs,
  renderTabTrigger,
}: IUnifiedSettingDialogContentProps) => {
  const { t } = useTranslation(
    uniq([...settingConfig.i18nNamespaces, ...spaceConfig.i18nNamespaces])
  );
  const { user } = useSession();
  const routeParams = useParams<{ spaceId?: string }>();
  const base = useBase() as { spaceId?: string } | undefined;
  const resolvedSpaceId = includeSpaceSettings
    ? spaceIdProp ?? routeParams?.spaceId ?? base?.spaceId
    : undefined;

  const { data: space } = useQuery({
    queryKey: ReactQueryKeys.space(resolvedSpaceId as string),
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1] as string).then((res) => res.data),
    enabled: Boolean(resolvedSpaceId),
  });

  const canAccessSpaceSettings = includeSpaceSettings && space?.role === Role.Owner;
  const isSpaceEntry = entry === 'space' && Boolean(resolvedSpaceId);
  const shouldKeepSpaceEntry = isSpaceEntry && !canAccessSpaceSettings;

  const personalTabs = useMemo<IUnifiedSettingListItem[]>(
    () => [
      {
        key: PersonalSettingTab.Profile,
        name: t('settings.account.tab'),
        Icon: User,
        content: <Account />,
      },
      {
        key: PersonalSettingTab.System,
        name: t('settings.setting.title'),
        Icon: Settings,
        content: <System />,
      },
      {
        key: PersonalSettingTab.Notifications,
        name: t('settings.notify.title'),
        Icon: Bell,
        content: <Notifications />,
      },
      {
        key: PersonalSettingTab.Integration,
        name: t('settings.integration.title'),
        Icon: Link,
        content: <Integration />,
      },
      {
        key: PersonalSettingTab.PersonalAccessToken,
        name: t('setting:personalAccessToken'),
        Icon: Key,
        content: <PersonalAccessTokenSection />,
      },
      {
        key: PersonalSettingTab.OAuthApp,
        name: t('setting:oauthApps'),
        Icon: Lock,
        content: <OAuthAppSection />,
      },
      ...(extraPersonalTabs ?? []),
    ],
    [extraPersonalTabs, t]
  );

  const spaceTabs = useMemo<IUnifiedSettingListItem[]>(() => {
    if (!resolvedSpaceId || !canAccessSpaceSettings) {
      return [];
    }

    return [
      {
        key: SpaceSettingTab.General,
        name: t('space:spaceSetting.general'),
        Icon: Settings2,
        content: ({ resolvedSpaceId }) => <GeneralPage spaceId={resolvedSpaceId} />,
      },
      {
        key: SpaceSettingTab.Collaborator,
        name: t('space:spaceSetting.collaborators'),
        Icon: Users,
        content: ({ resolvedSpaceId }) => <CollaboratorPage spaceId={resolvedSpaceId} />,
      },
      ...(extraSpaceTabs ?? []),
    ];
  }, [canAccessSpaceSettings, extraSpaceTabs, resolvedSpaceId, t]);

  const orderedGroups = useMemo<IUnifiedSettingGroup[]>(() => {
    const groups: IUnifiedSettingGroup[] = [
      {
        key: 'personal' as const,
        title: t('common:settings.personal.title'),
        entity: user ? (
          <div className="flex items-center justify-center gap-2 px-1 sm:justify-start">
            <UserAvatar className="size-8 rounded-full border" user={user} />
            <span className="hidden truncate text-sm font-medium text-foreground sm:block">
              {user.name}
            </span>
          </div>
        ) : null,
        tabs: personalTabs,
      },
      {
        key: 'space' as const,
        title: t('common:noun.space'),
        entity:
          resolvedSpaceId && space ? (
            <div className="flex items-center justify-center gap-2 px-1 sm:justify-start">
              <SpaceAvatar name={space.name} className="size-8 rounded-sm border" />
              <span className="hidden truncate text-sm font-medium text-foreground sm:block">
                {space.name}
              </span>
            </div>
          ) : null,
        tabs: spaceTabs,
      },
    ].filter((group) => group.tabs.length > 0);

    if (entry === 'space') {
      return groups.sort((a, b) => (a.key === 'space' ? -1 : b.key === 'space' ? 1 : 0));
    }

    return groups.sort((a, b) => (a.key === 'personal' ? -1 : b.key === 'personal' ? 1 : 0));
  }, [entry, personalTabs, resolvedSpaceId, space, spaceTabs, t, user]);

  const showSidebar = !contentOnly && orderedGroups.length > 0;
  const availableTabs = useMemo(
    () => orderedGroups.flatMap((group) => group.tabs.map(({ key }) => key)),
    [orderedGroups]
  );

  useEffect(() => {
    if (availableTabs.includes(tab)) {
      return;
    }

    if (shouldKeepSpaceEntry) {
      return;
    }

    const fallbackTab = availableTabs.includes(defaultTab) ? defaultTab : availableTabs[0];

    if (fallbackTab && fallbackTab !== tab) {
      onTabChange(fallbackTab);
    }
  }, [availableTabs, defaultTab, onTabChange, shouldKeepSpaceEntry, tab]);

  const renderContext = useMemo<IUnifiedSettingRenderContext>(
    () => ({ onTabChange, resolvedSpaceId, showSidebar }),
    [onTabChange, resolvedSpaceId, showSidebar]
  );

  const allTabs = useMemo(() => orderedGroups.flatMap((group) => group.tabs), [orderedGroups]);

  if (shouldKeepSpaceEntry) {
    return <div className="h-full" />;
  }

  return (
    <Tabs
      defaultValue={defaultTab}
      value={tab}
      onValueChange={onTabChange}
      className="flex h-full gap-0 overflow-hidden"
    >
      {showSidebar && (
        <TabsList className="flex h-full w-14 shrink-0 flex-col items-stretch justify-start gap-5 overflow-y-auto rounded-none border-r bg-muted p-2 shadow-none sm:w-60 sm:gap-8 sm:p-4">
          {orderedGroups.map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              <div className="space-y-2 sm:space-y-3">
                <p className="hidden pl-2 text-sm font-semibold text-muted-foreground sm:block">
                  {group.title}
                </p>
                {group.entity}
              </div>
              <div className="flex flex-col">
                {group.tabs.map((item) => {
                  const renderDefaultTrigger = (
                    overrides?: IUnifiedSettingTriggerOverrides
                  ): ReactElement => (
                    <TabsTrigger
                      key={item.key}
                      value={item.key}
                      className="h-8 w-full cursor-pointer justify-center gap-2 rounded-md px-0 font-normal data-[state=active]:bg-surface data-[state=active]:font-medium data-[state=active]:shadow-none hover:bg-primary/5 sm:justify-start sm:px-2"
                      disabled={overrides?.disabled ?? item.disabled}
                    >
                      <div className="flex items-center justify-center gap-2 sm:w-full sm:justify-between">
                        <div className="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
                          <item.Icon className="size-4 shrink-0" />
                          <span className="hidden truncate sm:block">{item.name}</span>
                        </div>
                        <span className="hidden sm:inline-flex">
                          {overrides?.badge ?? item.badge}
                        </span>
                      </div>
                    </TabsTrigger>
                  );

                  return renderTabTrigger
                    ? renderTabTrigger(item, renderContext, renderDefaultTrigger)
                    : renderDefaultTrigger();
                })}
              </div>
            </div>
          ))}
        </TabsList>
      )}

      {allTabs.map((item) => (
        <TabsContent
          key={item.key}
          tabIndex={-1}
          value={item.key}
          className={
            item.contentClassName ??
            (spaceTabs.some((spaceTab) => spaceTab.key === item.key)
              ? cn('mt-0 min-w-0 flex-1 focus-visible:outline-none', {
                  'overflow-y-auto overflow-x-hidden': showSidebar,
                })
              : 'mt-0 size-full overflow-y-auto overflow-x-hidden')
          }
        >
          {typeof item.content === 'function' ? item.content(renderContext) : item.content}
        </TabsContent>
      ))}
    </Tabs>
  );
};
