import { SpaceRole } from '../../auth';

export const SPACE_ROLE_LIST = [
  {
    role: SpaceRole.Creator,
    name: 'Creator',
    description: 'Can fully configure and edit bases',
    level: 1,
  },
  {
    role: SpaceRole.Editor,
    name: 'Editor',
    description: 'Can edit records and views, but cannot configure tables or fields',
    level: 2,
  },
  {
    role: SpaceRole.Commenter,
    name: 'Commenter',
    description: 'Can comment on records',
    level: 3,
  },
  {
    role: SpaceRole.Viewer,
    name: 'Viewer',
    description: 'Cannot edit or comment',
    level: 4,
  },
  {
    role: SpaceRole.Owner,
    name: 'Owner',
    description: 'Can fully configure and edit bases, and manage workspace settings and billing',
    level: 0,
  },
];
