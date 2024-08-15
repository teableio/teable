/* eslint-disable @typescript-eslint/naming-convention */
import { omit } from 'lodash';
import { z } from '../../zod';
import type { Action, SpaceAction } from '../actions';
import { RolePermission } from './constant';
import type { IRole } from './types';
import { Role } from './types';

export const BaseRole = {
  Creator: Role.Creator,
  Editor: Role.Editor,
  Commenter: Role.Commenter,
  Viewer: Role.Viewer,
} as const;

export const baseRolesSchema = z.nativeEnum(BaseRole);

export type IBaseRole = z.infer<typeof baseRolesSchema>;

type ExcludeSpaceAction<T> = T extends SpaceAction ? never : T;

export type BasePermission = ExcludeSpaceAction<Action>;

export const getBasePermission = (role: IRole): Record<BasePermission, boolean> => {
  return omit(RolePermission[role], ['space|create', 'space|delete', 'space|read']);
};
