import { useQuery } from '@tanstack/react-query';
import { Role } from '@teable/core';
import { Bell, Key, Link, Lock, Settings, Toolbox, User } from '@teable/icons';
import { getSpaceById } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase, useSession, useContentDir } from '@teable/sdk/hooks';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerSafeArea,
  DrawerTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { uniq } from 'lodash';
import { Check, Settings2, Users } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useTranslation } from 'next-i18next';
import type { ElementType, ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollaboratorPage } from '@/features/app/blocks/space-setting/collaborator';
import { GeneralPage } from '@/features/app/blocks/space-setting/general';
import { SpaceSettingTab } from '@/features/app/blocks/space-setting/types';
import { Account } from '@/features/app/components/setting/Account';
import { Integration } from '@/features/app/components/setting/integration/Integration';
import { Notifications } from '@/features/app/components/setting/Notifications';
import { OAuthAppSection } from '@/features/app/components/setting/oauth-app';
import { PersonalAccessTokenSection } from '@/features/app/components/setting/personal-access-token';
import { System } from '@/features/app/components/setting/System';
import { TeableSkillSection } from '@/features/app/components/setting/teable-skill';
import { PersonalSettingTab } from '@/features/app/components/setting/useSettingStore';
import { SpaceAvatar } from '@/features/app/components/space/SpaceAvatar';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { settingConfig } from '@/features/i18n/setting.config';
import { spaceConfig } from '@/features/i18n/space.config';
import { MobileSettingNavigationProvider } from './MobileSettingNavigation';

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
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const mobileNavigationTriggerRef = useRef<HTMLButtonElement>(null);
  const activeMobileItemRef = useRef<HTMLButtonElement>(null);
  const contentDir = useContentDir();
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
      {
        key: PersonalSettingTab.TeableSkill,
        name: t('common:settings.setting.teableSkill'),
        Icon: Toolbox,
        content: <TeableSkillSection />,
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
          <div className="flex min-w-0 items-center justify-start gap-2 px-1">
            <UserAvatar className="size-8 shrink-0 rounded-full border" user={user} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
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
            <div className="flex min-w-0 items-center justify-start gap-2 px-1">
              <SpaceAvatar
                name={space.name}
                avatar={space.avatar}
                className="size-8 shrink-0 rounded-sm border"
              />
              <span
                dir={contentDir}
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
              >
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
  }, [contentDir, entry, personalTabs, resolvedSpaceId, space, spaceTabs, t, user]);

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

  const handleTabChange = useCallback(
    (nextTab: UnifiedSettingTab) => {
      onTabChange(nextTab);
      setMobileNavigationOpen(false);
    },
    [onTabChange]
  );

  const mobileNavigationContext = useMemo(
    () => ({
      open: mobileNavigationOpen,
      onOpen: () => setMobileNavigationOpen(true),
      triggerRef: mobileNavigationTriggerRef,
    }),
    [mobileNavigationOpen]
  );

  useEffect(() => {
    if (!mobileNavigationOpen) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      activeMobileItemRef.current?.scrollIntoView({ block: 'nearest' });
    });

    return () => cancelAnimationFrame(frame);
  }, [mobileNavigationOpen, tab]);

  if (shouldKeepSpaceEntry) {
    return <div className="h-full" />;
  }

  return (
    <MobileSettingNavigationProvider value={showSidebar ? mobileNavigationContext : null}>
      <Tabs
        defaultValue={defaultTab}
        value={tab}
        onValueChange={handleTabChange}
        className="flex h-full min-h-0 gap-0 overflow-hidden"
      >
        {showSidebar && (
          <TabsList className="hidden h-full w-60 shrink-0 flex-col items-stretch justify-start gap-8 overflow-y-auto rounded-none border-e bg-muted p-4 shadow-none sm:flex">
            {orderedGroups.map((group) => (
              <div key={group.key} className="flex flex-col gap-2">
                <div className="space-y-3">
                  <p className="ps-2 text-sm font-semibold text-muted-foreground">{group.title}</p>
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
                        className="h-8 w-full cursor-pointer justify-start gap-2 rounded-md px-2 font-normal data-[state=active]:bg-surface data-[state=active]:font-medium data-[state=active]:shadow-none hover:bg-primary/5"
                        disabled={overrides?.disabled ?? item.disabled}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center justify-start gap-2">
                            <item.Icon className="size-4 shrink-0" />
                            <span className="truncate">{item.name}</span>
                          </div>
                          <span className="inline-flex">{overrides?.badge ?? item.badge}</span>
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

        {showSidebar && (
          <Drawer open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
            <DrawerContent
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                mobileNavigationTriggerRef.current?.focus({ preventScroll: true });
              }}
            >
              <DrawerHeader closeLabel={t('common:actions.close')}>
                <DrawerTitle>{t('common:settings.nav.settings')}</DrawerTitle>
              </DrawerHeader>
              <DrawerBody className="p-2">
                {orderedGroups.map((group, groupIndex) => (
                  <div key={group.key} className={cn(groupIndex > 0 && 'mt-2 border-t pt-2')}>
                    <div className="space-y-2 px-3 py-2">
                      <p className="text-xs text-muted-foreground">{group.title}</p>
                      {group.entity}
                    </div>
                    <div role="group" aria-label={group.title} className="flex flex-col">
                      {group.tabs.map((item) => {
                        const renderDefaultTrigger = (
                          overrides?: IUnifiedSettingTriggerOverrides
                        ): ReactElement => {
                          const isActive = tab === item.key;

                          return (
                            <button
                              key={item.key}
                              ref={isActive ? activeMobileItemRef : undefined}
                              type="button"
                              aria-pressed={isActive}
                              disabled={overrides?.disabled ?? item.disabled}
                              className={cn(
                                'flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                                isActive && 'bg-accent text-accent-foreground'
                              )}
                              onClick={() => handleTabChange(item.key)}
                            >
                              <item.Icon className="size-4 shrink-0" />
                              <span className="min-w-0 flex-1 truncate text-start">
                                {item.name}
                              </span>
                              <span className="inline-flex shrink-0">
                                {overrides?.badge ?? item.badge}
                              </span>
                              {isActive && <Check className="size-4 shrink-0" />}
                            </button>
                          );
                        };

                        return renderTabTrigger
                          ? renderTabTrigger(item, renderContext, renderDefaultTrigger)
                          : renderDefaultTrigger();
                      })}
                    </div>
                  </div>
                ))}
              </DrawerBody>
              <DrawerSafeArea />
            </DrawerContent>
          </Drawer>
        )}
      </Tabs>
    </MobileSettingNavigationProvider>
  );
};
