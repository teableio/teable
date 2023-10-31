/* eslint-disable @typescript-eslint/naming-convention */

import { keys, pickBy } from 'lodash';
import type {
  BaseActions,
  FieldActions,
  RecordActions,
  SpaceActions,
  TableActions,
  ViewActions,
} from './actions';
import type { SpaceRole } from './role';
import { spacePermissions } from './role';

export type PermissionAction =
  | SpaceActions
  | BaseActions
  | TableActions
  | ViewActions
  | FieldActions
  | RecordActions;

export const checkPermissions = (role: SpaceRole, actions: PermissionAction[]) => {
  return actions.every((action) => Boolean(spacePermissions[role][action]));
};

export const getPermissions = (role: SpaceRole) => {
  const result = pickBy(spacePermissions[role], (value) => value);
  return keys(result) as PermissionAction[];
};
