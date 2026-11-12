import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { HttpErrorCode } from '@teable/core';
import { HttpError, localizationSchema } from '@teable/core';
import { axios, ensureUndoRedoWindowIdHeader } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import { deleteBaseNodeVoSchema, type IDeleteBaseNodeVo } from './delete';

export const DELETE_BASE_NODE_STREAM = '/base/{baseId}/node/{nodeId}/stream';

export const deleteBaseNodeStreamEventSchema = z.union([
  z.object({
    id: z.literal('progress'),
    /** Resources the folder delete has deleted so far. */
    done: z.number(),
    total: z.number(),
  }),
  z.object({ id: z.literal('done'), data: deleteBaseNodeVoSchema }),
  z.object({
    id: z.literal('error'),
    message: z.string(),
    status: z.number(),
    code: z.string().optional(),
    localization: localizationSchema.optional(),
  }),
]);

export type IDeleteBaseNodeStreamEvent = z.infer<typeof deleteBaseNodeStreamEventSchema>;
export type IDeleteBaseNodeProgress = Extract<IDeleteBaseNodeStreamEvent, { id: 'progress' }>;

export const DeleteBaseNodeStreamRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_BASE_NODE_STREAM,
  title: 'Delete project node with progress',
  description:
    'Delete a node as DELETE /base/{baseId}/node/{nodeId} does, streaming server-sent events: `progress` as a folder delete deletes each resource in it, then `done` with the deleted node or `error`. Closing the stream does not stop the delete. A folder delete that stops part way leaves what it deleted in the trash on its own; deleting the folder again finishes it.',
  request: {
    params: z.object({
      baseId: z.string(),
      nodeId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'SSE stream of delete progress events and the final result',
    },
  },
  tags: ['base node'],
});

/** Deletes the node, reporting a folder delete's progress; rejects with the error event's HttpError. */
export const deleteBaseNodeStream = async (
  baseId: string,
  nodeId: string,
  options?: { onProgress?: (progress: IDeleteBaseNodeProgress) => void; signal?: AbortSignal }
): Promise<IDeleteBaseNodeVo> => {
  const url = `${axios.defaults.baseURL || '/api'}${urlBuilder(DELETE_BASE_NODE_STREAM, { baseId, nodeId })}`;
  let result: IDeleteBaseNodeStreamEvent | undefined;
  ensureUndoRedoWindowIdHeader();
  await streamSSE<IDeleteBaseNodeStreamEvent>(
    url,
    { method: 'DELETE', signal: options?.signal },
    {
      errorPrefix: 'Delete project node stream failed',
      onResult: (event) => {
        if (event.id === 'progress') options?.onProgress?.(event);
        else result = event;
      },
    }
  );
  if (result?.id === 'done') return result.data;
  if (result?.id === 'error') {
    const { message, status, code, localization } = result;
    throw new HttpError(
      { message, code: code as HttpErrorCode | undefined, data: { localization } },
      status
    );
  }
  throw new HttpError('Delete project node stream ended without a result', 500);
};
