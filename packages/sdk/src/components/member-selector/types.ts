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

export type SelectedMember = {
  id: string;
  type: TreeNodeType;
};

export interface SelectedMemberWithData extends SelectedMember {
  data: TreeNode;
}
