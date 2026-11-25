import { oc } from '@orpc/contract';

import {
  vcsChangesInputSchema,
  vcsCheckoutInputSchema,
  vcsCloneInputSchema,
  vcsCloneOutputSchema,
  vcsCloneRecordsInputSchema,
  vcsCloneRecordsOutputSchema,
  vcsDiffInputSchema,
  vcsDiffOutputSchema,
  vcsEnableInputSchema,
  vcsEnableOutputSchema,
  vcsHeadInfoSchema,
  vcsHeadInputSchema,
  vcsIncrementalChangesSchema,
  vcsPushInputSchema,
  vcsPushResultSchema,
  vcsRollbackInputSchema,
  vcsRollbackOutputSchema,
} from './schemas';

export const v2VcsContract = {
  enable: oc
    .route({
      method: 'POST',
      path: '/bases/{baseId}/vcs/enable',
      successStatus: 200,
      summary: 'Enable Base VCS change log tracking',
      tags: ['vcs'],
    })
    .input(vcsEnableInputSchema)
    .output(vcsEnableOutputSchema),
  head: oc
    .route({
      method: 'GET',
      path: '/bases/{baseId}/vcs/head',
      successStatus: 200,
      summary: 'Get base VCS head state',
      tags: ['vcs'],
    })
    .input(vcsHeadInputSchema)
    .output(vcsHeadInfoSchema),
  clone: oc
    .route({
      method: 'GET',
      path: '/bases/{baseId}/vcs/clone',
      successStatus: 200,
      summary: 'Clone base snapshot and capture pull cursor',
      tags: ['vcs'],
    })
    .input(vcsCloneInputSchema)
    .output(vcsCloneOutputSchema),
  cloneRecords: oc
    .route({
      method: 'GET',
      path: '/bases/{baseId}/vcs/clone/records',
      successStatus: 200,
      summary: 'Stream a keyset-paginated chunk of records for a cloned table',
      tags: ['vcs'],
    })
    .input(vcsCloneRecordsInputSchema)
    .output(vcsCloneRecordsOutputSchema),
  changes: oc
    .route({
      method: 'GET',
      path: '/bases/{baseId}/vcs/changes',
      successStatus: 200,
      summary: 'List incremental VCS changes since pull cursor',
      tags: ['vcs'],
    })
    .input(vcsChangesInputSchema)
    .output(vcsIncrementalChangesSchema),
  checkout: oc
    .route({
      method: 'GET',
      path: '/bases/{baseId}/vcs/history/checkout',
      successStatus: 200,
      summary: 'Read an immutable revision under current access permissions',
      tags: ['vcs'],
    })
    .input(vcsCheckoutInputSchema)
    .output(vcsCloneOutputSchema),
  diff: oc
    .route({
      method: 'GET',
      path: '/bases/{baseId}/vcs/history/diff',
      successStatus: 200,
      summary: 'Compare two revisions and identify their merge base',
      tags: ['vcs'],
    })
    .input(vcsDiffInputSchema)
    .output(vcsDiffOutputSchema),
  rollback: oc
    .route({
      method: 'POST',
      path: '/bases/{baseId}/vcs/history/rollback',
      successStatus: 200,
      summary: 'Preview a restore or confirm it as a new revision',
      tags: ['vcs'],
    })
    .input(vcsRollbackInputSchema)
    .output(vcsRollbackOutputSchema),
  push: oc
    .route({
      method: 'POST',
      path: '/bases/{baseId}/vcs/push',
      successStatus: 200,
      summary: 'Push local VCS patch atomically',
      tags: ['vcs'],
    })
    .input(vcsPushInputSchema)
    .output(vcsPushResultSchema),
};

export type V2VcsContract = typeof v2VcsContract;
