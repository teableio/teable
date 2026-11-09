import type { Action, IVisibleScopeGroup } from '@teable/core';
import {
  ACCESS_TOKEN_SCOPE_PARTIAL,
  AccessTokenScopeGroup,
  AccessTokenScopeLevel,
  accessTokenScopeMap,
  getAccessTokenGroupActions,
  getAccessTokenGroupLevel,
  setAccessTokenGroupLevel,
} from '@teable/core';
import { ChevronRight } from '@teable/icons';
import { usePermissionActionsStatic } from '@teable/sdk/hooks';
import { Button, Checkbox, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useMemo, useState } from 'react';

interface IScopeGroupsProps {
  scopes: string[];
  groups: IVisibleScopeGroup[];
  onChange: (scopes: string[]) => void;
  query: string;
  showGroups: boolean;
}

const levels = [
  AccessTokenScopeLevel.None,
  AccessTokenScopeLevel.Read,
  AccessTokenScopeLevel.Write,
] as const;

const Highlight = ({ text, query }: { text: string; query: string }) => {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-amber-200 px-px text-inherit dark:bg-amber-500/40">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
};

export const ScopeGroups = ({ scopes, groups, onChange, query, showGroups }: IScopeGroupsProps) => {
  const { t } = useTranslation('token');
  const { actionStaticMap } = usePermissionActionsStatic();
  const [expanded, setExpanded] = useState<Partial<Record<AccessTokenScopeGroup, boolean>>>({});
  const toggleGroup = (group: AccessTokenScopeGroup, open: boolean) =>
    setExpanded((prev) => ({ ...prev, [group]: open }));
  const scopeSet = useMemo(() => new Set(scopes), [scopes]);
  const trimmedQuery = query.trim();

  const isMatch = (action: Action) => {
    if (!trimmedQuery) return false;
    const lower = trimmedQuery.toLowerCase();
    return (
      action.toLowerCase().includes(lower) ||
      (actionStaticMap[action]?.description ?? '').toLowerCase().includes(lower)
    );
  };

  const searchResults = useMemo(() => {
    if (!trimmedQuery) return [];
    return groups
      .flatMap((group) => {
        const { read, write } = getAccessTokenGroupActions(group);
        return [...read, ...write];
      })
      .filter(isMatch)
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, groups, actionStaticMap]);

  const toggleAction = (action: Action, checked: boolean) => {
    onChange(checked ? [...scopes, action] : scopes.filter((scope) => scope !== action));
  };

  const setLevel = (group: AccessTokenScopeGroup, level: AccessTokenScopeLevel) => {
    onChange(setAccessTokenGroupLevel(scopes, group, level));
  };

  const levelText = (level: AccessTokenScopeLevel) => t(`permission.levelLabels.${level}`);

  const renderAction = (action: Action) => {
    const checked = scopeSet.has(action);
    return (
      <label
        key={action}
        className={cn(
          'grid cursor-pointer grid-cols-[minmax(8rem,12rem)_1fr_auto] items-center gap-3 border-t px-3 py-1.5 text-sm first:border-t-0',
          !checked && 'text-muted-foreground/70',
          isMatch(action) && 'bg-amber-100/60 dark:bg-amber-500/10'
        )}
      >
        <span className="truncate">
          <Highlight text={actionStaticMap[action]?.description ?? action} query={trimmedQuery} />
        </span>
        <code className="truncate font-mono text-xs text-muted-foreground">
          <Highlight text={action} query={trimmedQuery} />
        </code>
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => toggleAction(action, value === true)}
        />
      </label>
    );
  };

  const needsSchemaRead =
    [AccessTokenScopeGroup.Data, AccessTokenScopeGroup.Automation].some(
      (group) => getAccessTokenGroupLevel(scopes, group) !== AccessTokenScopeLevel.None
    ) && !(scopeSet.has('table|read') && scopeSet.has('field|read'));

  return (
    <div className="space-y-2">
      {trimmedQuery && (
        <div className="overflow-hidden rounded-lg border">
          {searchResults.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {t('permission.searchEmpty', { query: trimmedQuery })}
            </div>
          )}
          {searchResults.map((action) => {
            const { level } = accessTokenScopeMap[action];
            // Results only come from the visible groups passed in.
            const group = accessTokenScopeMap[action].group as IVisibleScopeGroup;
            return (
              <div
                key={action}
                className="flex items-center justify-between gap-3 border-t px-3 py-2 text-sm first:border-t-0"
              >
                <div className="min-w-0">
                  <Highlight
                    text={actionStaticMap[action]?.description ?? action}
                    query={trimmedQuery}
                  />{' '}
                  <code className="font-mono text-xs text-muted-foreground">
                    <Highlight text={action} query={trimmedQuery} />
                  </code>
                  <div className="text-xs text-muted-foreground">
                    {t('permission.belongsTo', {
                      group: t(`permission.groups.${group}.name`),
                      level: levelText(level),
                    })}
                  </div>
                </div>
                {scopeSet.has(action) ? (
                  <span className="shrink-0 text-xs text-green-600">
                    {t('permission.included')}
                  </span>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => toggleAction(action, true)}
                  >
                    {t('permission.check')}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {showGroups && (
        <div className="rounded-lg border">
          {groups.map((group) => {
            const { read, write } = getAccessTokenGroupActions(group);
            const groupLevel = getAccessTokenGroupLevel(scopes, group);
            const total = read.length + write.length;
            const checkedCount = [...read, ...write].filter((action) =>
              scopeSet.has(action)
            ).length;
            const isOpen = expanded[group] ?? [...read, ...write].some((action) => isMatch(action));
            return (
              <div key={group} className="border-t first:border-t-0">
                {/* The whole header toggles the list; the level buttons stop propagation. */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-3 hover:bg-accent"
                  onClick={() => toggleGroup(group, !isOpen)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' '))
                      return;
                    e.preventDefault();
                    toggleGroup(group, !isOpen);
                  }}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <ChevronRight
                      className={cn(
                        'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                        isOpen && 'rotate-90'
                      )}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {t(`permission.groups.${group}.name`)}
                        <span className="ms-2 text-xs font-normal text-muted-foreground">
                          {t('permission.permissionCount', { count: total })}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t(`permission.groups.${group}.description`)}
                      </div>
                      {group === AccessTokenScopeGroup.Schema && needsSchemaRead && (
                        <div className="text-xs text-amber-600">
                          {t('permission.needSchemaRead')}
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    className="flex shrink-0 cursor-default items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    {groupLevel === ACCESS_TOKEN_SCOPE_PARTIAL && (
                      <span className="text-xs text-amber-600">
                        {t('permission.partial', {
                          count: checkedCount,
                          total,
                        })}
                      </span>
                    )}
                    <div className="inline-flex overflow-hidden rounded-md border">
                      {levels.map((level) => (
                        <button
                          key={level}
                          type="button"
                          className={cn(
                            'border-s px-3 py-1 text-xs text-muted-foreground first:border-s-0 hover:text-foreground',
                            groupLevel === level &&
                              'bg-primary text-primary-foreground hover:text-primary-foreground'
                          )}
                          onClick={() => setLevel(group, level)}
                        >
                          {t(`permission.levels.${level}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div className="space-y-1.5 px-3.5 pb-3 ps-9">
                    {[
                      { key: AccessTokenScopeLevel.Read, actions: read },
                      { key: AccessTokenScopeLevel.Write, actions: write },
                    ].map(({ key, actions }) =>
                      actions.length ? (
                        <Fragment key={key}>
                          <div className="text-xs text-muted-foreground">
                            {t(`permission.levels.${key}`)}
                          </div>
                          <div className="overflow-hidden rounded-md border">
                            {actions.map(renderAction)}
                          </div>
                        </Fragment>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
