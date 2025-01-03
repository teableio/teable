import type { IGetDepartmentVo, IGetDepartmentUserItem } from '@teable/openapi';

export enum TreeNodeType {
  USER = 'user',
  DEPARTMENT = 'department',
}

export type UserNode = Pick<IGetDepartmentUserItem, 'id' | 'name' | 'email' | 'avatar'> & {
  type: TreeNodeType.USER;
};

export type DepartmentNode = Pick<IGetDepartmentVo, 'id' | 'name'> & {
  type: TreeNodeType.DEPARTMENT;
};

export type TreeNode = UserNode | DepartmentNode;

export type SelectedUser = {
  id: string;
  type: TreeNodeType.USER;
};

export type SelectedDepartment = {
  id: string;
  type: TreeNodeType.DEPARTMENT;
};

export type SelectedMember = SelectedUser | SelectedDepartment;

type SelectedUserWithData = SelectedUser & {
  data: UserNode;
};

type SelectedDepartmentWithData = SelectedDepartment & {
  data: DepartmentNode;
};

export type SelectedMemberWithData = SelectedUserWithData | SelectedDepartmentWithData;
