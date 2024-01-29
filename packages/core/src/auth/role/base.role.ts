import { z } from '../../zod';

export enum BaseRole {
  Creator = 'creator',
  Editor = 'editor',
  Commenter = 'commenter',
  Viewer = 'viewer',
}

export const baseRolesSchema = z.nativeEnum(BaseRole);
