/* eslint-disable sonarjs/no-duplicate-string */
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import { createSnapshotRoSchema, createSnapshotVoSchema, sandboxSnapshotSchema } from './schemas';
import type { ICreateSnapshotRo, ICreateSnapshotVo, ISandboxSnapshot } from './schemas';

// ─── Route Constants ─────────────────────────────────────────────

export const LIST_SANDBOX_SNAPSHOTS = '/admin/sandbox/snapshots';
export const CREATE_SANDBOX_BASE_SNAPSHOT = '/admin/sandbox/snapshots/base';
export const CREATE_SANDBOX_APP_BUILDER_SNAPSHOT = '/admin/sandbox/snapshots/app-builder';
export const DELETE_SANDBOX_SNAPSHOT = '/admin/sandbox/snapshots/{id}';
export const SYNC_SANDBOX_SNAPSHOTS = '/admin/sandbox/snapshots/sync';

// ─── Route Definitions ──────────────────────────────────────────

export const listSandboxSnapshotsRoute = registerRoute({
  method: 'get',
  path: LIST_SANDBOX_SNAPSHOTS,
  description: 'List all sandbox base snapshots (admin)',
  responses: {
    200: {
      description: 'List of snapshots',
      content: {
        'application/json': { schema: z.array(sandboxSnapshotSchema) },
      },
    },
  },
  tags: ['sandbox-admin'],
});

export const createSandboxBaseSnapshotRoute = registerRoute({
  method: 'post',
  path: CREATE_SANDBOX_BASE_SNAPSHOT,
  description: 'Create a sandbox base snapshot (admin)',
  request: {
    body: {
      content: {
        'application/json': { schema: createSnapshotRoSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Snapshot creation initiated',
      content: {
        'application/json': { schema: createSnapshotVoSchema },
      },
    },
  },
  tags: ['sandbox-admin'],
});

export const deleteSandboxSnapshotRoute = registerRoute({
  method: 'delete',
  path: DELETE_SANDBOX_SNAPSHOT,
  description: 'Delete a sandbox snapshot (admin)',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'Snapshot deleted' },
  },
  tags: ['sandbox-admin'],
});

export const syncSandboxSnapshotsRoute = registerRoute({
  method: 'post',
  path: SYNC_SANDBOX_SNAPSHOTS,
  description: 'Sync remote snapshots from provider (admin)',
  responses: {
    200: {
      description: 'Sync result',
      content: {
        'application/json': {
          schema: z.object({
            imported: z.number(),
            skipped: z.number(),
          }),
        },
      },
    },
  },
  tags: ['sandbox-admin'],
});

// ─── API Functions ───────────────────────────────────────────────

export const listSandboxSnapshots = () => axios.get<ISandboxSnapshot[]>(LIST_SANDBOX_SNAPSHOTS);

export const createSandboxBaseSnapshot = (body: ICreateSnapshotRo) =>
  axios.post<ICreateSnapshotVo>(CREATE_SANDBOX_BASE_SNAPSHOT, body);

export const deleteSandboxSnapshot = (id: string) =>
  axios.delete<{ success: boolean }>(urlBuilder(DELETE_SANDBOX_SNAPSHOT, { id }));

export const createAppBuilderSnapshot = () =>
  axios.post<ICreateSnapshotVo>(CREATE_SANDBOX_APP_BUILDER_SNAPSHOT);

export const syncSandboxSnapshots = () =>
  axios.post<{ imported: number; skipped: number }>(SYNC_SANDBOX_SNAPSHOTS);
