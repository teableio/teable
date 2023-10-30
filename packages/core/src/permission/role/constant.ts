import { SpaceRole } from '../../auth';

export const SPACE_ROLE_LIST = [
  {
    role: SpaceRole.Creator,
    name: 'Creator',
    description: 'Can fully configure and edit bases',
  },
  {
    role: SpaceRole.Editor,
    name: 'Editor',
    description: 'Can edit records and views, but cannot configure tables or fields',
  },
  {
    role: SpaceRole.Commenter,
    name: 'Commenter',
    description: 'Can comment on records',
  },
  {
    role: SpaceRole.Viewer,
    name: 'Viewer',
    description: 'Cannot edit or comment',
  },
  {
    role: SpaceRole.Owner,
    name: 'Owner',
    description: 'Can fully configure and edit bases, and manage workspace settings and billing',
  },
];
