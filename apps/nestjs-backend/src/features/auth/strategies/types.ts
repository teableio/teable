import { z } from '@teable/openapi';
import type { Request } from 'express';

export interface IPayloadUser {
  id: string;
}

export type IFromExtractor = (req: Request) => string | null;

export interface IJwtAuthInfo {
  userId: string;
  allowSystemUser?: boolean;
  /** Where the token is used from; `sandbox` = an AI agent acting on the user's behalf. */
  source?: 'sandbox';
  /** Whose chat minted the token; the user stays the actor but credentials resolve for this principal. */
  sandboxPrincipal?: { principalType: string; principalId: string };
}

export enum JwtAuthInternalType {
  Automation = 'automation',
  App = 'app',
  User = 'user',
}

const workflowContextSchema = z.object({
  actionId: z.string(),
  workflowId: z.string(),
  workflowName: z.string().optional(),
});

export type IWorkflowContext = z.infer<typeof workflowContextSchema>;

const jwtAuthInternalBaseInfoSchema = z.object({
  baseId: z.string(),
  userId: z.string().optional(),
  context: z.unknown().optional(),
});

export const jwtAuthInternalInfoSchema = jwtAuthInternalBaseInfoSchema.and(
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal(JwtAuthInternalType.Automation),
      context: workflowContextSchema.optional(),
    }),
    z.object({
      type: z.literal(JwtAuthInternalType.App),
    }),
    z.object({
      type: z.literal(JwtAuthInternalType.User),
    }),
  ])
);

export type IJwtAuthInternalInfo = z.infer<typeof jwtAuthInternalInfoSchema>;
