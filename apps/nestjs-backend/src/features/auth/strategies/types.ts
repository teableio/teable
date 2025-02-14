import type { Request } from 'express';

export interface IPayloadUser {
  id: string;
}

export type IFromExtractor = (req: Request) => string | null;

export interface IJwtAuthInfo {
  userId: string;
}
