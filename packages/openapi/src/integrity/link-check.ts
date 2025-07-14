import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const CHECK_BASE_INTEGRITY = '/integrity/base/{baseId}/link-check';

// Define the issue types enum
export enum IntegrityIssueType {
  ForeignTableNotFound = 'ForeignTableNotFound',
  ForeignKeyNotFound = 'ForeignKeyNotFound',
  SelfKeyNotFound = 'SelfKeyNotFound',
  SymmetricFieldNotFound = 'SymmetricFieldNotFound',
  MissingRecordReference = 'MissingRecordReference',
  InvalidLinkReference = 'InvalidLinkReference',
  ForeignKeyHostTableNotFound = 'ForeignKeyHostTableNotFound',
  ReferenceFieldNotFound = 'ReferenceFieldNotFound',
  UniqueIndexNotFound = 'UniqueIndexNotFound',
}

// Define the schema for a single issue
export const integrityIssueSchema = z.object({
  type: z.nativeEnum(IntegrityIssueType),
  message: z.string(),
  fieldId: z.string(),
});

// Define the schema for a link field check item
export const linkFieldCheckItemSchema = z.object({
  baseId: z
    .string()
    .optional()
    .openapi({ description: 'The base id of the link field with is cross-base' }),
  baseName: z.string().optional(),
  tableId: z.string().optional(),
  tableName: z.string().optional(),
  issues: z.array(integrityIssueSchema),
});

export type IIntegrityIssue = z.infer<typeof integrityIssueSchema>;

// Define the response schema
export const integrityCheckVoSchema = z.object({
  hasIssues: z.boolean(),
  linkFieldIssues: z.array(linkFieldCheckItemSchema),
});

export type IIntegrityCheckVo = z.infer<typeof integrityCheckVoSchema>;

export const IntegrityCheckRoute: RouteConfig = registerRoute({
  method: 'get',
  path: CHECK_BASE_INTEGRITY,
  description: 'Check integrity of link fields in a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns integrity check results for the base',
      content: {
        'application/json': {
          schema: integrityCheckVoSchema,
        },
      },
    },
  },
  tags: ['integrity'],
});

export const checkBaseIntegrity = async (baseId: string) => {
  return axios.get<IIntegrityCheckVo>(
    urlBuilder(CHECK_BASE_INTEGRITY, {
      baseId,
    })
  );
};
