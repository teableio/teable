import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema, IdPrefix } from '@teable/core';
import { axios, ensureUndoRedoWindowIdHeader } from '../axios';
import { contentQueryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import {
  type IClearSelectionStreamDoneEvent,
  type IClearSelectionStreamErrorEvent,
  type IClearSelectionStreamEvent,
  type IClearSelectionStreamProgressEvent,
} from './clear-stream';
import { deleteVoSchema, type IDeleteVo } from './delete';
import {
  type IDeleteSelectionStreamDoneEvent,
  type IDeleteSelectionStreamErrorEvent,
  type IDeleteSelectionStreamEvent,
  type IDeleteSelectionStreamProgressEvent,
} from './delete-stream';
import {
  type IPasteSelectionStreamDoneEvent,
  type IPasteSelectionStreamErrorEvent,
  type IPasteSelectionStreamEvent,
  type IPasteSelectionStreamProgressEvent,
} from './paste-stream';

export const CLEAR_BY_ID_URL = '/table/{tableId}/selection/clear-by-id';
export const CLEAR_BY_ID_STREAM_URL = `${CLEAR_BY_ID_URL}-stream`;
export const PASTE_BY_ID_URL = '/table/{tableId}/selection/paste-by-id';
export const PASTE_BY_ID_STREAM_URL = `${PASTE_BY_ID_URL}-stream`;
export const DELETE_BY_ID_URL = '/table/{tableId}/selection/delete-by-id';
export const DELETE_BY_ID_STREAM_URL = `${DELETE_BY_ID_URL}-stream`;

const recordIdsSchema = z.array(z.string().startsWith(IdPrefix.Record));
const fieldIdsSchema = z.array(z.string().startsWith(IdPrefix.Field));

export const selectionIdScopeSchema = z
  .object({
    recordIds: recordIdsSchema.optional().meta({
      description:
        'Explicit selected record ids. If omitted, records are resolved from the current query scope. An empty array means no existing records are selected.',
    }),
    excludeRecordIds: recordIdsSchema.optional().meta({
      description: 'Record ids to exclude from the current query scope, for inverse selections.',
    }),
    fieldIds: fieldIdsSchema.min(1).optional().meta({
      description:
        'Explicit selected field ids. If omitted, fields are resolved from visible query fields.',
    }),
  })
  .refine((selection) => !(selection.recordIds != null && selection.excludeRecordIds != null), {
    message: 'recordIds and excludeRecordIds cannot be used together',
  });

export const selectionRecordIdScopeSchema = z
  .object({
    recordIds: recordIdsSchema.optional().meta({
      description:
        'Explicit selected record ids. If omitted, records are resolved from the current query scope. An empty array means no existing records are selected.',
    }),
    excludeRecordIds: recordIdsSchema.optional().meta({
      description: 'Record ids to exclude from the current query scope, for inverse selections.',
    }),
  })
  .refine((selection) => !(selection.recordIds != null && selection.excludeRecordIds != null), {
    message: 'recordIds and excludeRecordIds cannot be used together',
  });

export const selectionIdMutationBaseRoSchema = contentQueryBaseSchema.extend({
  projection: fieldIdsSchema.optional().meta({
    description:
      'Visible field ids for query-scoped field selection. If omitted, all visible view fields are used.',
  }),
  selection: selectionIdScopeSchema,
});

export type ISelectionIdMutationBaseRo = z.infer<typeof selectionIdMutationBaseRoSchema>;

export const clearByIdRoSchema = selectionIdMutationBaseRoSchema;
export type IClearByIdRo = z.infer<typeof clearByIdRoSchema>;

export const pasteByIdRoSchema = selectionIdMutationBaseRoSchema.extend({
  content: z
    .string()
    .or(z.array(z.array(z.unknown())))
    .meta({
      description: 'Content to paste',
      example: 'John\tDoe\tjohn.doe@example.com',
    }),
  header: z.array(fieldVoSchema).optional().meta({
    description: 'Table header for paste operation',
    example: [],
  }),
});

export type IPasteByIdRo = z.infer<typeof pasteByIdRoSchema>;

export const pasteByIdVoSchema = z.object({
  selection: z.object({
    recordIds: recordIdsSchema,
    fieldIds: fieldIdsSchema,
  }),
  pastedRecordIds: recordIdsSchema.optional(),
  pastedFieldIds: fieldIdsSchema.optional(),
  createdRecordIds: recordIdsSchema.optional(),
  createdFieldIds: fieldIdsSchema.optional(),
  createdChoiceIdsByFieldId: z
    .record(z.string().startsWith(IdPrefix.Field), z.array(z.string()))
    .optional(),
  createdForeignRecordIds: recordIdsSchema.optional(),
  skippedAttachments: z.array(z.unknown()).optional(),
});

export type IPasteByIdVo = z.infer<typeof pasteByIdVoSchema>;

export const deleteByIdRoSchema = contentQueryBaseSchema.extend({
  selection: selectionRecordIdScopeSchema,
});

export type IDeleteByIdRo = z.infer<typeof deleteByIdRoSchema>;

export const ClearByIdRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: CLEAR_BY_ID_URL,
  summary: 'Clear selected records and fields by id',
  description: 'Clear selected cells using record and field identifiers instead of row ranges.',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: clearByIdRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successful clean up',
    },
  },
  tags: ['selection'],
});

export const PasteByIdRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: PASTE_BY_ID_URL,
  summary: 'Paste content by selected record and field ids',
  description: 'Apply paste content using record and field identifiers instead of row ranges.',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: pasteByIdRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Paste successfully',
      content: {
        'application/json': {
          schema: pasteByIdVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
});

export const DeleteByIdRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DELETE_BY_ID_URL,
  summary: 'Delete selected records by id',
  description: 'Delete selected records using record identifiers or a query scope with exclusions.',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: deleteByIdRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successful deletion',
      content: {
        'application/json': {
          schema: deleteVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
});

export const ClearByIdStreamRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: CLEAR_BY_ID_STREAM_URL,
  summary: 'Clear selected records and fields by id with SSE progress',
  description: 'Clear selected cells by id and stream realtime progress.',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: clearByIdRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with clear progress events and final result',
    },
  },
  tags: ['selection'],
});

export const PasteByIdStreamRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: PASTE_BY_ID_STREAM_URL,
  summary: 'Paste selected records and fields by id with SSE progress',
  description: 'Paste selected cells by id and stream realtime progress.',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: pasteByIdRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with paste progress events and final result',
    },
  },
  tags: ['selection'],
});

export const DeleteByIdStreamRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DELETE_BY_ID_STREAM_URL,
  summary: 'Delete selected records by id with SSE progress',
  description: 'Delete selected records by id and stream realtime progress.',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: deleteByIdRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with deletion progress events and final result',
    },
  },
  tags: ['selection'],
});

export const clearById = async (tableId: string, clearRo: IClearByIdRo) => {
  return axios.patch<null>(urlBuilder(CLEAR_BY_ID_URL, { tableId }), clearRo);
};

export const pasteById = async (tableId: string, pasteRo: IPasteByIdRo) => {
  return axios.patch<IPasteByIdVo>(urlBuilder(PASTE_BY_ID_URL, { tableId }), pasteRo);
};

export const deleteById = async (tableId: string, deleteRo: IDeleteByIdRo) => {
  return axios.post<IDeleteVo>(urlBuilder(DELETE_BY_ID_URL, { tableId }), deleteRo);
};

export const clearByIdSelectionStream = async (
  tableId: string,
  clearRo: IClearByIdRo,
  options?: {
    onProgress?: (event: IClearSelectionStreamProgressEvent) => void;
    onError?: (event: IClearSelectionStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<{
  data: null;
  done: IClearSelectionStreamDoneEvent;
  errors: IClearSelectionStreamErrorEvent[];
}> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(CLEAR_BY_ID_STREAM_URL, { tableId }),
  });
  let doneEvent: IClearSelectionStreamDoneEvent | null = null;
  const errors: IClearSelectionStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IClearSelectionStreamEvent>(
    url,
    {
      method: 'PATCH',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(clearRo),
    },
    {
      errorPrefix: 'Clear selection by id stream failed',
      onResult: (result) => {
        switch (result.id) {
          case 'progress':
            options?.onProgress?.(result);
            return;
          case 'done':
            doneEvent = result;
            return;
          case 'error':
            errors.push(result);
            options?.onError?.(result);
            return;
        }
      },
    }
  );

  if (!doneEvent) {
    const lastError = errors.at(-1);
    throw new Error(lastError?.message ?? 'Clear selection by id stream ended without result');
  }

  return { data: null, done: doneEvent, errors };
};

export const pasteByIdSelectionStream = async (
  tableId: string,
  pasteRo: IPasteByIdRo,
  options?: {
    onProgress?: (event: IPasteSelectionStreamProgressEvent) => void;
    onError?: (event: IPasteSelectionStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<{
  data: IPasteByIdVo | null;
  done: IPasteSelectionStreamDoneEvent;
  errors: IPasteSelectionStreamErrorEvent[];
}> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(PASTE_BY_ID_STREAM_URL, { tableId }),
  });
  let doneEvent: IPasteSelectionStreamDoneEvent | null = null;
  const errors: IPasteSelectionStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IPasteSelectionStreamEvent>(
    url,
    {
      method: 'PATCH',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(pasteRo),
    },
    {
      errorPrefix: 'Paste selection by id stream failed',
      onResult: (result) => {
        switch (result.id) {
          case 'progress':
            options?.onProgress?.(result);
            return;
          case 'done':
            doneEvent = result;
            return;
          case 'error':
            errors.push(result);
            options?.onError?.(result);
            return;
        }
      },
    }
  );

  if (!doneEvent) {
    const lastError = errors.at(-1);
    throw new Error(lastError?.message ?? 'Paste selection by id stream ended without result');
  }

  const finalDoneEvent = doneEvent as IPasteSelectionStreamDoneEvent;
  const data = finalDoneEvent.data.selection
    ? {
        selection: finalDoneEvent.data.selection,
        pastedRecordIds: finalDoneEvent.data.pastedRecordIds?.length
          ? finalDoneEvent.data.pastedRecordIds
          : undefined,
        pastedFieldIds: finalDoneEvent.data.pastedFieldIds?.length
          ? finalDoneEvent.data.pastedFieldIds
          : undefined,
        createdRecordIds: finalDoneEvent.data.createdRecordIds.length
          ? finalDoneEvent.data.createdRecordIds
          : undefined,
        createdFieldIds: finalDoneEvent.data.createdFieldIds?.length
          ? finalDoneEvent.data.createdFieldIds
          : undefined,
        createdChoiceIdsByFieldId: finalDoneEvent.data.createdChoiceIdsByFieldId,
        createdForeignRecordIds: finalDoneEvent.data.createdForeignRecordIds?.length
          ? finalDoneEvent.data.createdForeignRecordIds
          : undefined,
        skippedAttachments: finalDoneEvent.data.skippedAttachments,
      }
    : null;
  return { data, done: finalDoneEvent, errors };
};

export const deleteByIdSelectionStream = async (
  tableId: string,
  deleteRo: IDeleteByIdRo,
  options?: {
    onProgress?: (event: IDeleteSelectionStreamProgressEvent) => void;
    onError?: (event: IDeleteSelectionStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<{
  data: IDeleteVo;
  done: IDeleteSelectionStreamDoneEvent;
  errors: IDeleteSelectionStreamErrorEvent[];
}> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(DELETE_BY_ID_STREAM_URL, { tableId }),
  });
  let finalResult: IDeleteVo | null = null;
  let doneEvent: IDeleteSelectionStreamDoneEvent | null = null;
  const errors: IDeleteSelectionStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IDeleteSelectionStreamEvent>(
    url,
    {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(deleteRo),
    },
    {
      errorPrefix: 'Delete selection by id stream failed',
      onResult: (result) => {
        switch (result.id) {
          case 'progress':
            options?.onProgress?.(result);
            return;
          case 'done':
            doneEvent = result;
            finalResult = deleteVoSchema.parse({ ids: result.data.deletedRecordIds });
            return;
          case 'error':
            errors.push(result);
            options?.onError?.(result);
            return;
        }
      },
    }
  );

  if (!finalResult || !doneEvent) {
    const lastError = errors.at(-1);
    throw new Error(lastError?.message ?? 'Delete selection by id stream ended without result');
  }

  return { data: finalResult, done: doneEvent, errors };
};
