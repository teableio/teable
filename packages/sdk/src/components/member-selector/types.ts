import type { IGetDepartmentVo, IGetDepartmentUserItem } from '@teable/openapi';

export enum TreeNodeType {
  PERSON = 'person',
  ORGANIZATION = 'organization',
}

export type PersonNode = IGetDepartmentUserItem & {
  type: TreeNodeType.PERSON;
};

export type OrganizationNode = IGetDepartmentVo & {
  type: TreeNodeType.ORGANIZATION;
};

export type TreeNode = PersonNode | OrganizationNode;

export type SelectedMember = {
  id: string;
  type: TreeNodeType;
};

export interface SelectedMemberWithData extends SelectedMember {
  data: TreeNode;
}
