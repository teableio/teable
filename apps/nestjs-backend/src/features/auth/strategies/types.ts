import type { Request } from 'express';

export interface IPayloadUser {
  id: string;
}

export type IFromExtractor = (req: Request) => string | null;

export interface IJwtAuthInfo {
  userId: string;
}

export enum JwtAuthInternalType {
  Automation = 'automation',
  App = 'app',
}

export interface IJwtAuthInternalInfo {
  type: JwtAuthInternalType;
  baseId: string;
}
