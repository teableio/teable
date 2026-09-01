import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { toSSERequestError } from '../utils/sse';
import { z } from '../zod';
import { createBaseVoSchema } from './create';

export const IMPORT_GOOGLE_SHEET_ANALYZE = '/base/import-google-sheet/analyze';
export const IMPORT_GOOGLE_SHEET_STREAM = '/base/import-google-sheet/stream';
export const IMPORT_GOOGLE_SHEET_PICKER_CONFIG = '/base/import-google-sheet/picker-config';

const googleSheetCredentialsShape = {
  integrationId: z.string().optional().meta({
    description:
      'Id of a connected Google Sheets user integration; its access token is resolved (and refreshed) server-side and never leaves the server for API calls.',
  }),
  accessToken: z.string().min(1).optional().meta({
    description:
      'Raw Google OAuth access token with the drive.file scope (never persisted by the server). Ignored when integrationId is provided.',
  }),
  // When neither credential is given the server falls back to public mode: an
  // instance API key can read spreadsheets shared as "anyone with the link".
};

export const importGoogleSheetAnalyzeRoSchema = z.object({
  ...googleSheetCredentialsShape,
  spreadsheetId: z.string().min(1).meta({
    description:
      'Google Drive file id of the spreadsheet, as returned by the Google Picker. The OAuth grant only covers files the user picked (drive.file scope).',
  }),
  includeSampleRows: z.boolean().optional().meta({
    description:
      "Also return each tab's first few rows as cell texts (one extra Sheets API request). Off by default: callers that only list tabs should not pay for it.",
  }),
});

export type IImportGoogleSheetAnalyzeRo = z.infer<typeof importGoogleSheetAnalyzeRoSchema>;

export const importGoogleSheetAnalyzeVoSchema = z.object({
  spreadsheet: z.object({
    id: z.string(),
    title: z.string(),
    sheets: z.array(
      z.object({
        /** Numeric grid id of the tab inside the spreadsheet (stable across renames). */
        sheetId: z.number(),
        title: z.string(),
        rowCount: z.number(),
        columnCount: z.number(),
        /**
         * The tab's first rows as raw cell texts (headers are NOT assumed to
         * be row 1 — templates often start with banners or blank rows). Only
         * with includeSampleRows and only best-effort (absent again when the
         * extra read failed — never a failed analyze).
         */
        sampleRows: z.array(z.array(z.string())).optional(),
      })
    ),
  }),
});

export type IImportGoogleSheetAnalyzeVo = z.infer<typeof importGoogleSheetAnalyzeVoSchema>;

export const importGoogleSheetIssueSchema = z.object({
  code: z.enum(['valuesDropped', 'sheetSkipped', 'columnsTruncated']),
  sheetName: z.string(),
  fieldName: z.string().optional(),
  count: z.number().optional(),
  reason: z.string().optional(),
});

export type IImportGoogleSheetIssue = z.infer<typeof importGoogleSheetIssueSchema>;

export const importGoogleSheetRoSchema = z
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
    ...googleSheetCredentialsShape,
    spreadsheetId: z.string().min(1),
    baseName: z.string().min(1).optional().meta({
      description:
        'Name for the created base (normally the spreadsheet title). Required unless baseId is set.',
    }),
    sheetIds: z
      .array(z.number())
      .min(1)
      .optional()
      .meta({
        description:
          'Numeric ids of the tabs to import (from analyze). When omitted all tabs are imported; ' +
          'an explicitly empty array is rejected (it would silently mean "all").',
      }),
    importRecords: z.boolean().optional().meta({
      description: 'Import record data (default true). When false only the structure is created.',
    }),
  })
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

export type IImportGoogleSheetRo = z.infer<typeof importGoogleSheetRoSchema>;

export const importGoogleSheetVoSchema = z.object({
  base: createBaseVoSchema,
  /** Google sheetId (stringified number) -> created Teable table id. */
  tableIdMap: z.record(z.string(), z.string()),
  issues: z.array(importGoogleSheetIssueSchema),
});

export type IImportGoogleSheetVo = z.infer<typeof importGoogleSheetVoSchema>;

export const googleSheetPickerConfigVoSchema = z.object({
  /** Google API key with the Picker API enabled (public, referrer-restricted). */
  apiKey: z.string(),
  /**
   * Google Cloud project number. The Picker must run in the same project as
   * the OAuth client for a pick to grant drive.file access to the file.
   */
  appId: z.string(),
});

export type IGoogleSheetPickerConfigVo = z.infer<typeof googleSheetPickerConfigVoSchema>;

export interface IImportGoogleSheetProgressEvent {
  type: 'progress';
  phase: string;
  detail?: string;
  tableName?: string;
  tableIndex?: number;
  totalTables?: number;
  /** Scanned grid rows (drives the progress bar; includes empty padding rows). */
  processedRows?: number;
  /** Declared grid row count of the tab; an upper bound, trailing empty rows included. */
  totalRows?: number;
  /** Records actually written to the table so far (differs from processedRows on sparse sheets). */
  importedRecords?: number;
}

export type ImportGoogleSheetProgressCallback = (
  phase: string,
  detail?: string,
  event?: IImportGoogleSheetProgressEvent
) => void;

export interface IImportGoogleSheetErrorEvent {
  type: 'error';
  message: string;
  /** Present when the import failed midway: everything imported before the failure. */
  partial?: Omit<IImportGoogleSheetVo, 'base'> & { base?: IImportGoogleSheetVo['base'] };
}

export type IImportGoogleSheetSSEEvent =
  | IImportGoogleSheetProgressEvent
  | { type: 'done'; data: IImportGoogleSheetVo }
  | IImportGoogleSheetErrorEvent;

/**
 * Thrown by importGoogleSheetStream when the server reports a failure.
 * `partial` carries the tables that were fully imported before the error, so
 * callers can keep them and offer the target base instead of losing the work.
 */
export class ImportGoogleSheetStreamError extends Error {
  constructor(
    message: string,
    public readonly partial?: IImportGoogleSheetErrorEvent['partial']
  ) {
    super(message);
    this.name = 'ImportGoogleSheetStreamError';
  }
}

export const ImportGoogleSheetAnalyzeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: IMPORT_GOOGLE_SHEET_ANALYZE,
  description: 'List the tabs (worksheets) of a picked Google spreadsheet before import',
  summary: 'analyze a Google Sheets import source',
  request: {
    body: {
      content: {
        'application/json': {
          schema: importGoogleSheetAnalyzeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns the spreadsheet title and its tabs with grid sizes.',
      content: {
        'application/json': {
          schema: importGoogleSheetAnalyzeVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const ImportGoogleSheetStreamRoute: RouteConfig = registerRoute({
  method: 'post',
  path: IMPORT_GOOGLE_SHEET_STREAM,
  description: 'import a Google spreadsheet with SSE progress stream',
  summary: 'import a Google spreadsheet with SSE progress events',
  request: {
    body: {
      content: {
        'application/json': {
          schema: importGoogleSheetRoSchema,
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

export const GoogleSheetPickerConfigRoute: RouteConfig = registerRoute({
  method: 'get',
  path: IMPORT_GOOGLE_SHEET_PICKER_CONFIG,
  description:
    'Public client config for opening the Google Picker (API key and Cloud project number)',
  summary: 'get Google Picker client config',
  responses: {
    200: {
      description: 'Returns the Picker API key and app id.',
      content: {
        'application/json': {
          schema: googleSheetPickerConfigVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const importGoogleSheetAnalyze = async (ro: IImportGoogleSheetAnalyzeRo) => {
  return await axios.post<IImportGoogleSheetAnalyzeVo>(urlBuilder(IMPORT_GOOGLE_SHEET_ANALYZE), ro);
};

export const getGoogleSheetPickerConfig = async () => {
  return await axios.get<IGoogleSheetPickerConfigVo>(urlBuilder(IMPORT_GOOGLE_SHEET_PICKER_CONFIG));
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
  event: IImportGoogleSheetSSEEvent,
  onProgress?: ImportGoogleSheetProgressCallback
): IImportGoogleSheetVo | undefined => {
  switch (event.type) {
    case 'progress':
      onProgress?.(event.phase, event.detail, event);
      return undefined;
    case 'done':
      return event.data;
    case 'error':
      throw new ImportGoogleSheetStreamError(
        event.message.trim() || 'Import from Google Sheets failed',
        event.partial
      );
  }
};

const processSSELine = (
  line: string,
  onProgress?: ImportGoogleSheetProgressCallback
): IImportGoogleSheetVo | undefined => {
  if (!line.startsWith('data: ')) return undefined;
  const jsonStr = line.slice(6).trim();
  if (!jsonStr) return undefined;
  try {
    return handleSSEEvent(JSON.parse(jsonStr) as IImportGoogleSheetSSEEvent, onProgress);
  } catch (e) {
    // Re-throw stream domain errors, only ignore malformed JSON chunks.
    if (!(e instanceof SyntaxError)) throw e;
    return undefined;
  }
};

/**
 * Import a Google spreadsheet with SSE progress streaming.
 * Uses fetch API to handle the text/event-stream response.
 */
export const importGoogleSheetStream = async (
  importGoogleSheetRo: IImportGoogleSheetRo,
  onProgress?: ImportGoogleSheetProgressCallback
): Promise<{ data: IImportGoogleSheetVo }> => {
  const baseURL = axios.defaults.baseURL || '/api';
  const url = `${baseURL}${urlBuilder(IMPORT_GOOGLE_SHEET_STREAM)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildSSERequestHeaders(),
    body: JSON.stringify(importGoogleSheetRo),
    credentials: 'include',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw toSSERequestError(errorText, response.status, 'Import from Google Sheets failed');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body for SSE stream');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let result: IImportGoogleSheetVo | null = null;

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
    throw new Error('Import from Google Sheets stream ended without result');
  }

  return { data: result };
};
