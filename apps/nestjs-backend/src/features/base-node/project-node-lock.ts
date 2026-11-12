import ms from 'ms';

/**
 * The lock a project's node tree changes under: node moves, folder deletes, and trash restores and
 * purges. It keeps the name of the move lock it grew out of, so a pod still running the previous
 * release excludes against it too.
 */
export const projectNodeLockName = (baseId: string) => `base-node-move:${baseId}`;

/**
 * Renewed while the change runs (DistributedLockService), so this bounds only how long the lock
 * outlives an instance that died holding it.
 */
export const PROJECT_NODE_LOCK_TTL_SECONDS = ms('1m') / 1000;
