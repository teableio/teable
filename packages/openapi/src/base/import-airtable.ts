import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { createBaseVoSchema } from './create';

export const IMPORT_AIRTABLE_ANALYZE = '/base/import-airtable/analyze';
export const IMPORT_AIRTABLE_STREAM = '/base/import-airtable/stream';

const airtableCredentialsShape = {
  integrationId: z.string().optional().meta({
    description:
      'Id of a connected Airtable user integration; its access token is resolved (and refreshed) server-side and never leaves the server.',
  }),
  accessToken: z.string().min(1).optional().meta({
    description:
      'Airtable personal access token for direct API usage (never persisted by the server). Ignored when integrationId is provided.',
  }),
};

const requireAirtableCredentials = (
  data: { integrationId?: string; accessToken?: string },
  ctx: z.RefinementCtx
) => {
  if (!data.integrationId && !data.accessToken) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either integrationId or accessToken is required',
      path: ['integrationId'],
    });
  }
};

const requireShareLinkForViewConfig = (
  data: { importViewConfig?: boolean; shareLink?: string },
  ctx: z.RefinementCtx
) => {
  if (data.importViewConfig && !data.shareLink?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A shareLink is required to import view configuration',
      path: ['shareLink'],
    });
  }
};

export const importAirtableAnalyzeRoSchema = z
  .object({
    ...airtableCredentialsShape,
    airtableBaseId: z.string().optional().meta({
      description:
        'When omitted the accessible Airtable bases are listed; when provided the base schema summary is returned.',
    }),
  })
  .superRefine(requireAirtableCredentials);

export type IImportAirtableAnalyzeRo = z.infer<typeof importAirtableAnalyzeRoSchema>;

export const importAirtableIssueSchema = z.object({
  code: z.enum([
    'fieldDegraded',
    'fieldSkipped',
    'viewSkipped',
    'valuesDropped',
    'viewConfigDegraded',
  ]),
  tableName: z.string(),
  fieldName: z.string().optional(),
  viewName: z.string().optional(),
  fromType: z.string().optional(),
  toType: z.string().optional(),
  count: z.number().optional(),
  reason: z.string().optional(),
});

export type IImportAirtableIssue = z.infer<typeof importAirtableIssueSchema>;

export const importAirtableAnalyzeVoSchema = z.object({
  bases: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        permissionLevel: z.string(),
      })
    )
    .optional(),
  base: z
    .object({
      id: z.string(),
      tables: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          fieldCount: z.number(),
          viewCount: z.number(),
        })
      ),
      issues: z.array(importAirtableIssueSchema),
    })
    .optional(),
});

export type IImportAirtableAnalyzeVo = z.infer<typeof importAirtableAnalyzeVoSchema>;

export const importAirtableRoSchema = z
  .object({
    spaceId: z
      .string()
      .optional()
      .meta({
        description:
          'Target space for the new base. Required only when baseId is omitted; when importing ' +
          "into an existing base the base's own space is used and spaceId is ignored.",
      }),
    baseId: z
      .string()
      .optional()
      .meta({
        description:
          'Import into this existing base (add its tables) instead of creating a new one. ' +
          'When omitted, a new base named baseName is created in spaceId.',
      }),
    ...airtableCredentialsShape,
    airtableBaseId: z.string().min(1),
    baseName: z.string().min(1).optional().meta({
      description:
        'Name for the created base (normally the Airtable base name). Required unless baseId is set.',
    }),
    importRecords: z.boolean().optional().meta({
      description: 'Import record data (default true). When false only the structure is created.',
    }),
    importAttachments: z.boolean().optional().meta({
      description: 'Download attachments from Airtable and re-upload them (default true).',
    }),
    importViewConfig: z
      .boolean()
      .optional()
      .meta({
        description:
          'Import view filters, sorts, grouping and kanban stacking. Requires shareLink, ' +
          'because the official Airtable API does not expose view configuration.',
      }),
    shareLink: z
      .string()
      .optional()
      .meta({
        description:
          'Public Airtable shared-base link (https://airtable.com/appXXX/shrYYY). Used read-only ' +
          'to read view configuration; must point at airtableBaseId. The token never sees it.',
      }),
  })
  .superRefine(requireAirtableCredentials)
  .superRefine(requireShareLinkForViewConfig)
  .superRefine((value, ctx) => {
    if (!value.baseId && !value.baseName) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseName'],
        message: 'baseName is required when baseId is not provided.',
      });
    }
    if (!value.baseId && !value.spaceId) {
      ctx.addIssue({
        code: 'custom',
        path: ['spaceId'],
        message: 'spaceId is required when baseId is not provided.',
      });
    }
  });

export type IImportAirtableRo = z.infer<typeof importAirtableRoSchema>;

export const importAirtableVoSchema = z.object({
  base: createBaseVoSchema,
  tableIdMap: z.record(z.string(), z.string()),
  fieldIdMap: z.record(z.string(), z.string()),
  issues: z.array(importAirtableIssueSchema),
});

export type IImportAirtableVo = z.infer<typeof importAirtableVoSchema>;

export interface IImportAirtableProgressEvent {
  type: 'progress';
  phase: string;
  detail?: string;
  tableName?: string;
  tableIndex?: number;
  totalTables?: number;
  processedRows?: number;
}

export type ImportAirtableProgressCallback = (
  phase: string,
  detail?: string,
  event?: IImportAirtableProgressEvent
) => void;

export type IImportAirtableSSEEvent =
  | IImportAirtableProgressEvent
  | { type: 'done'; data: IImportAirtableVo }
  | { type: 'error'; message: string };

export const ImportAirtableAnalyzeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: IMPORT_AIRTABLE_ANALYZE,
  description: 'List accessible Airtable bases or summarize one base schema before import',
  summary: 'analyze an Airtable import source',
  request: {
    body: {
      content: {
        'application/json': {
          schema: importAirtableAnalyzeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns accessible bases or the schema summary of the requested base.',
      content: {
        'application/json': {
          schema: importAirtableAnalyzeVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const ImportAirtableStreamRoute: RouteConfig = registerRoute({
  method: 'post',
  path: IMPORT_AIRTABLE_STREAM,
  description: 'import an Airtable base with SSE progress stream',
  summary: 'import an Airtable base with SSE progress events',
  request: {
    body: {
      content: {
        'application/json': {
          schema: importAirtableRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with progress events and final result',
    },
  },
  tags: ['base'],
});

export const importAirtableAnalyze = async (ro: IImportAirtableAnalyzeRo) => {
  return await axios.post<IImportAirtableAnalyzeVo>(urlBuilder(IMPORT_AIRTABLE_ANALYZE), ro);
};

const buildSSERequestHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  for (const name of ['Authorization', 'Cookie']) {
    const value = axios.defaults.headers.common?.[name];
    if (value && typeof value === 'string') {
      headers[name] = value;
    }
  }
  return headers;
};

const handleSSEEvent = (
  event: IImportAirtableSSEEvent,
  onProgress?: ImportAirtableProgressCallback
): IImportAirtableVo | undefined => {
  switch (event.type) {
    case 'progress':
      onProgress?.(event.phase, event.detail, event);
      return undefined;
    case 'done':
      return event.data;
    case 'error':
      throw new Error(event.message.trim() || 'Import from Airtable failed');
  }
};

const processSSELine = (
  line: string,
  onProgress?: ImportAirtableProgressCallback
): IImportAirtableVo | undefined => {
  if (!line.startsWith('data: ')) return undefined;
  const jsonStr = line.slice(6).trim();
  if (!jsonStr) return undefined;
  try {
    return handleSSEEvent(JSON.parse(jsonStr) as IImportAirtableSSEEvent, onProgress);
  } catch (e) {
    // Re-throw stream domain errors, only ignore malformed JSON chunks.
    if (!(e instanceof SyntaxError)) throw e;
    return undefined;
  }
};

/**
 * Import an Airtable base with SSE progress streaming.
 * Uses fetch API to handle the text/event-stream response.
 */
export const importAirtableStream = async (
  importAirtableRo: IImportAirtableRo,
  onProgress?: ImportAirtableProgressCallback
): Promise<{ data: IImportAirtableVo }> => {
  const baseURL = axios.defaults.baseURL || '/api';
  const url = `${baseURL}${urlBuilder(IMPORT_AIRTABLE_STREAM)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildSSERequestHeaders(),
    body: JSON.stringify(importAirtableRo),
    credentials: 'include',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Import from Airtable failed: ${response.status} ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body for SSE stream');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let result: IImportAirtableVo | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      result = processSSELine(line, onProgress) ?? result;
    }
  }

  // Flush decoder and process the final buffered line in case the stream
  // ended without a trailing newline.
  buffer += decoder.decode();
  if (buffer.trim()) {
    result = processSSELine(buffer, onProgress) ?? result;
  }

  if (!result) {
    throw new Error('Import from Airtable stream ended without result');
  }

  return { data: result };
};
