import { z } from 'zod';

import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
} from '../shared/http';

export const searchAccessPathStatusStateSchema = z.enum([
  'disabled',
  'ready',
  'rebuild_pending',
  'stale',
  'unknown',
]);

export const searchAccessPathStatusSchema = z
  .object({
    tableId: z.string(),
    state: searchAccessPathStatusStateSchema,
    configured: z.boolean(),
    languageConfig: z.string().optional(),
    semantics: z.enum(['substring', 'lexical']).optional(),
    provider: z.enum(['pg_trgm', 'pg_bigm', 'tsvector']).optional(),
    accessPath: z.enum(['generated_text', 'generated_tsvector']).optional(),
    coveredFieldCount: z.number().int().nonnegative(),
  })
  .strict();

export const getSearchAccessPathStatusInputSchema = z
  .object({
    tableId: z.string(),
  })
  .strict();

export const getSearchAccessPathStatusResponseDataSchema = z
  .object({
    status: searchAccessPathStatusSchema,
  })
  .strict();

export type IGetSearchAccessPathStatusInput = z.infer<typeof getSearchAccessPathStatusInputSchema>;
export type IGetSearchAccessPathStatusResponseData = z.infer<
  typeof getSearchAccessPathStatusResponseDataSchema
>;
export type IGetSearchAccessPathStatusResponse =
  IApiResponseDto<IGetSearchAccessPathStatusResponseData>;
export type IGetSearchAccessPathStatusOkResponse =
  IApiOkResponseDto<IGetSearchAccessPathStatusResponseData>;
export type IGetSearchAccessPathStatusErrorResponse = IApiErrorResponseDto;
export type IGetSearchAccessPathStatusEndpointResult =
  | { status: 200; body: IGetSearchAccessPathStatusOkResponse }
  | { status: HttpErrorStatus; body: IGetSearchAccessPathStatusErrorResponse };

export const getSearchAccessPathStatusOkResponseSchema = apiOkResponseDtoSchema(
  getSearchAccessPathStatusResponseDataSchema
);
export const getSearchAccessPathStatusErrorResponseSchema = apiErrorResponseDtoSchema;

export const searchAccessPathCapabilitySchema = z
  .object({
    provider: z.enum(['pg_trgm', 'pg_bigm']),
    extensionName: z.enum(['pg_trgm', 'pg_bigm']),
    operatorClass: z.enum(['gin_trgm_ops', 'gin_bigm_ops']),
    operatorClassSchema: z.string().optional(),
    operatorClassInstalled: z.boolean(),
    minimumProbeLength: z.number().int().nonnegative(),
    state: z.enum([
      'ready',
      'requires_database_extension',
      'requires_cluster_restart',
      'unavailable',
    ]),
    installed: z.boolean(),
    available: z.boolean(),
    preloaded: z.boolean(),
    reason: z.string().optional(),
  })
  .strict();

export const getSearchAccessPathCapabilitiesInputSchema = z.object({}).strict();
export const getSearchAccessPathCapabilitiesResponseDataSchema = z
  .object({
    capabilities: z.array(searchAccessPathCapabilitySchema),
  })
  .strict();

export type IGetSearchAccessPathCapabilitiesInput = z.infer<
  typeof getSearchAccessPathCapabilitiesInputSchema
>;
export type IGetSearchAccessPathCapabilitiesResponseData = z.infer<
  typeof getSearchAccessPathCapabilitiesResponseDataSchema
>;
export type IGetSearchAccessPathCapabilitiesResponse =
  IApiResponseDto<IGetSearchAccessPathCapabilitiesResponseData>;
export type IGetSearchAccessPathCapabilitiesOkResponse =
  IApiOkResponseDto<IGetSearchAccessPathCapabilitiesResponseData>;
export type IGetSearchAccessPathCapabilitiesErrorResponse = IApiErrorResponseDto;
export type IGetSearchAccessPathCapabilitiesEndpointResult =
  | { status: 200; body: IGetSearchAccessPathCapabilitiesOkResponse }
  | { status: HttpErrorStatus; body: IGetSearchAccessPathCapabilitiesErrorResponse };

export const getSearchAccessPathCapabilitiesOkResponseSchema = apiOkResponseDtoSchema(
  getSearchAccessPathCapabilitiesResponseDataSchema
);
export const getSearchAccessPathCapabilitiesErrorResponseSchema = apiErrorResponseDtoSchema;

export const reconcileSearchAccessPathInputSchema = z
  .object({
    tableId: z.string(),
    mode: z.enum(['create', 'rebuild', 'drop']),
    expectedDefinitionKey: z.string().max(512).optional(),
    semantics: z.enum(['substring', 'lexical']).optional(),
    provider: z.enum(['pg_trgm', 'pg_bigm', 'tsvector']).optional(),
    languageConfig: z.string().max(128).optional(),
    fieldIds: z.array(z.string().max(128)).min(1).max(500).optional(),
    searchProbe: z.string().max(2_000).optional(),
  })
  .strict();

export const reconcileSearchAccessPathResultSchema = z
  .object({
    action: z.enum(['created', 'rebuilt', 'verified', 'dropped']),
    tableId: z.string(),
    definitionKey: z.string(),
    generatedColumnName: z.string(),
    indexName: z.string(),
    languageConfig: z.string(),
    semantics: z.enum(['substring', 'lexical']).optional(),
    provider: z.enum(['pg_trgm', 'pg_bigm', 'tsvector']).optional(),
    fieldIds: z.array(z.string()),
    status: z.enum(['ready', 'disabled']),
    planEvidence: z.unknown().optional(),
  })
  .strict();

export const reconcileSearchAccessPathResponseDataSchema = z
  .object({
    result: reconcileSearchAccessPathResultSchema,
  })
  .strict();

export type IReconcileSearchAccessPathInput = z.infer<typeof reconcileSearchAccessPathInputSchema>;
export type IReconcileSearchAccessPathResponseData = z.infer<
  typeof reconcileSearchAccessPathResponseDataSchema
>;
export type IReconcileSearchAccessPathResponse =
  IApiResponseDto<IReconcileSearchAccessPathResponseData>;
export type IReconcileSearchAccessPathOkResponse =
  IApiOkResponseDto<IReconcileSearchAccessPathResponseData>;
export type IReconcileSearchAccessPathErrorResponse = IApiErrorResponseDto;
export type IReconcileSearchAccessPathEndpointResult =
  | { status: 200; body: IReconcileSearchAccessPathOkResponse }
  | { status: HttpErrorStatus; body: IReconcileSearchAccessPathErrorResponse };

export const reconcileSearchAccessPathOkResponseSchema = apiOkResponseDtoSchema(
  reconcileSearchAccessPathResponseDataSchema
);
export const reconcileSearchAccessPathErrorResponseSchema = apiErrorResponseDtoSchema;
