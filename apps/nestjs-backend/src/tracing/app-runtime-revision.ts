/* eslint-disable @typescript-eslint/naming-convention -- OpenTelemetry attribute keys are dotted. */
export const APP_RUNTIME_REVISION_ENV_KEY = 'TEABLE_APP_REVISION';
export const APP_RUNTIME_REVISION_HEADER = 'x-teable-app-revision';
export const APP_RUNTIME_REVISION_PATTERN = /^[\w-]{1,512}$/;

export type AppRuntimeRevision =
  | {
      runtime: 'published' | 'preview';
      source: 'saved';
      version?: number;
      commitSha?: string;
    }
  | {
      runtime: 'preview';
      source: 'workspace';
      baseVersion?: number;
      baseCommitSha?: string;
    };

const revisionNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

const revisionCommitSha = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : undefined;

/** Host-managed runtime provenance; archive tokens and unknown revision fields never leave here. */
export const appRuntimeRevisionEnv = (revision: AppRuntimeRevision): Record<string, string> => ({
  // JSON quotes do not round-trip through Next's dotenv loader; use an opaque ASCII envelope.
  [APP_RUNTIME_REVISION_ENV_KEY]: Buffer.from(
    JSON.stringify(
      revision.source === 'saved'
        ? {
            runtime: revision.runtime,
            source: revision.source,
            version: revisionNumber(revision.version),
            commitSha: revisionCommitSha(revision.commitSha),
          }
        : {
            runtime: revision.runtime,
            source: revision.source,
            baseVersion: revisionNumber(revision.baseVersion),
            baseCommitSha: revisionCommitSha(revision.baseCommitSha),
          }
    ),
    'utf8'
  ).toString('base64url'),
});

const decodeRevision = (header: unknown): Record<string, unknown> | undefined => {
  if (typeof header !== 'string' || !APP_RUNTIME_REVISION_PATTERN.test(header)) return;
  try {
    const raw: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
  } catch {
    return;
  }
};

const readRevisionIdentity = (rawVersion: unknown, rawCommit: unknown) => {
  const version = revisionNumber(rawVersion);
  const commitSha = revisionCommitSha(rawCommit);
  if (
    (rawVersion !== undefined && version === undefined) ||
    (rawCommit !== undefined && commitSha === undefined)
  ) {
    return;
  }
  return { version, commitSha };
};

/** Diagnostic metadata only. The caller must already have an authenticated App identity. */
export const appRuntimeRevisionAttributes = (
  header: unknown
): Record<string, string | number> | undefined => {
  const revision = decodeRevision(header);
  if (!revision || (revision.runtime !== 'preview' && revision.runtime !== 'published')) return;
  const saved = revision.source === 'saved';
  if (!saved && (revision.source !== 'workspace' || revision.runtime !== 'preview')) return;
  const identity = readRevisionIdentity(
    saved ? revision.version : revision.baseVersion,
    saved ? revision.commitSha : revision.baseCommitSha
  );
  if (!identity) return;
  const { version, commitSha } = identity;
  if (saved && version === undefined && commitSha === undefined) return;
  const attributes: Record<string, string | number> = {
    'teable.app.runtime': revision.runtime,
    'teable.app.source': saved ? 'saved' : 'workspace',
  };
  const prefix = saved ? 'teable.app.' : 'teable.app.base_';
  if (version !== undefined) attributes[`${prefix}version`] = version;
  if (commitSha !== undefined) attributes[`${prefix}commit_sha`] = commitSha;
  return attributes;
};
