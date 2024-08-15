import type { Action } from '@teable/core';
import { ActionPrefix } from '@teable/core';
import { Hash, PackageCheck, Sheet, Square, Table2, User } from '@teable/icons';
import { usePermissionActionsStatic } from '@teable/sdk/hooks';
import { Badge, cn } from '@teable/ui-lib/shadcn';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IconMap: Partial<Record<ActionPrefix, React.JSXElementConstructor<any>>> = {
  [ActionPrefix.Table]: Table2,
  [ActionPrefix.Field]: Hash,
  [ActionPrefix.Record]: Square,
  [ActionPrefix.View]: Sheet,
  [ActionPrefix.Automation]: PackageCheck,
  [ActionPrefix.User]: User,
};

export const OAuthScope = (props: {
  scopes?: string[];
  description?: string | ReactNode;
  className?: string;
}) => {
  const { scopes, description, className } = props;
  const { actionPrefixStaticMap, actionStaticMap } = usePermissionActionsStatic();

  const scopeMap = useMemo(
    () =>
      (scopes || []).reduce(
        (acc, scope) => {
          if (!actionStaticMap) {
            return acc;
          }
          const prefix = scope.split('|')[0] as ActionPrefix;
          const scopeDesc = actionStaticMap[scope as Action].description;
          if (acc[prefix]) {
            acc[prefix].push(scopeDesc);
          } else {
            acc[prefix] = [scopeDesc];
          }
          return acc;
        },
        {} as Record<ActionPrefix, string[]>
      ),
    [actionStaticMap, scopes]
  );
  return (
    <div className={cn('space-y-3 px-8', className)}>
      {description && typeof description === 'string' ? (
        <div className="text-center">{description}</div>
      ) : (
        description
      )}
      {Object.entries(scopeMap).map(([prefix, scopes]) => {
        const ScopeIcon = IconMap[prefix as ActionPrefix];
        return (
          <div key={prefix} className="space-y-2">
            <strong className="flex items-center gap-2 text-sm">
              {ScopeIcon && <ScopeIcon />}
              {actionPrefixStaticMap[prefix as ActionPrefix].title}
            </strong>
            <div className="flex flex-wrap gap-2">
              {scopes.map((scope) => (
                <Badge key={scope} variant={'outline'} className="text-xs font-normal">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
