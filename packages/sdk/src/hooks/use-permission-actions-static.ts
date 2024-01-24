/* eslint-disable @typescript-eslint/naming-convention */
import type { ActionPrefixMap, AllActions } from '@teable-group/core';
import { ActionPrefix, actionPrefixMap } from '@teable-group/core';
import { useTranslation } from '../context/app/i18n';

const actionDescriptions: Record<AllActions, string> = {
  'space|create': 'spaceCreate',
  'space|delete': 'spaceDelete',
  'space|read': 'spaceRead',
  'space|update': 'spaceUpdate',
  'space|invite_email': 'spaceInviteEmail',
  'space|invite_link': 'spaceInviteLink',
  'space|grant_role': 'spaceGrantRole',
  'base|create': 'baseCreate',
  'base|delete': 'baseDelete',
  'base|read': 'baseRead',
  'base|update': 'baseUpdate',
  'base|invite_email': 'baseInviteEmail',
  'base|invite_link': 'baseInviteLink',
  'table|create': 'tableCreate',
  'table|read': 'tableRead',
  'table|delete': 'tableDelete',
  'table|update': 'tableUpdate',
  'table|import': 'tableImport',
  'view|create': 'viewCreate',
  'view|delete': 'viewDelete',
  'view|read': 'viewRead',
  'view|update': 'viewUpdate',
  'field|create': 'fieldCreate',
  'field|delete': 'fieldDelete',
  'field|read': 'fieldRead',
  'field|update': 'fieldUpdate',
  'record|create': 'recordCreate',
  'record|comment': 'recordComment',
  'record|delete': 'recordDelete',
  'record|read': 'recordRead',
  'record|update': 'recordUpdate',
};

export const usePermissionActionsStatic = <Excludes extends ActionPrefix[] | undefined = undefined>(
  excludes?: Excludes
): {
  [K in Exclude<ActionPrefix, Excludes extends ActionPrefix[] ? Excludes[number] : never>]: {
    action: ActionPrefixMap[K][number];
    description: string;
  }[];
} => {
  const { t } = useTranslation();
  const actionPrefix = excludes
    ? Object.values(ActionPrefix).filter((key) => !excludes.includes(key))
    : Object.values(ActionPrefix);

  return actionPrefix.reduce(
    (acc, prefix) => {
      acc[prefix] = actionPrefixMap[prefix].map((action) => ({
        action,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        description: t(`permission.actionDescription.${actionDescriptions[action]}` as any),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any;
      return acc;
    },
    {} as {
      [K in ActionPrefix]: {
        action: ActionPrefixMap[K][number];
        description: string;
      }[];
    }
  );
};
