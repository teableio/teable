import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import type { AttachmentItem } from '@teable/v2-core';
import { sql, type Kysely } from 'kysely';

export interface ILocalAttachmentStoreOptions {
  /** Meta database that owns the `attachments` file-metadata table. */
  db: Kysely<unknown>;
  /** Directory that owns the content-addressed attachment files. */
  rootDir: string;
  /** Actor recorded in `attachments.created_by`. */
  actorId: string;
  /** Optional host-provided image thumbnail generator. */
  thumbnailer?: ILocalAttachmentThumbnailer;
}

export interface ILocalAttachmentThumbnailInput {
  name: string;
  mimetype: string;
  data: Uint8Array;
  hash: string;
}

export interface ILocalAttachmentThumbnails {
  sm?: Uint8Array;
  lg?: Uint8Array;
}

export type ILocalAttachmentThumbnailer = (
  input: ILocalAttachmentThumbnailInput
) => ILocalAttachmentThumbnails | Promise<ILocalAttachmentThumbnails>;

export interface ILocalAttachmentInput {
  name: string;
  mimetype: string;

  data: Uint8Array;
  width?: number;
  height?: number;
}

export interface ILocalAttachmentGcOptions {
  /** Keep unreferenced uploads newer than this grace period. Defaults to 24h. */
  olderThanMs?: number;
  dryRun?: boolean;
  limit?: number;
}

export interface ILocalAttachmentGcResult {
  deleted: number;
  filesDeleted: number;
}

/**
 * Local filesystem attachment storage. Files are content-addressed and the
 * `attachments` metadata row is written to the meta database so the record
 * adapter can validate and index attachment cells.
 */
export class LocalAttachmentStore {
  constructor(private readonly options: ILocalAttachmentStoreOptions) {}

  async put(input: ILocalAttachmentInput): Promise<AttachmentItem> {
    const hash = createHash('sha256').update(input.data).digest('hex');
    const token = `tok_${hash}`;
    const id = `att${hash.slice(0, 32)}`;
    const path = `sha256/${hash.slice(0, 2)}/${hash}`;
    const filePath = this.resolvePath(path);

    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, input.data);
    await rename(tempPath, filePath);

    const thumbnails = this.options.thumbnailer
      ? await this.options.thumbnailer({
          name: input.name,
          mimetype: input.mimetype,
          data: input.data,
          hash,
        })
      : undefined;
    const thumbnailPaths: { sm?: string; lg?: string } = {};
    for (const size of ['sm', 'lg'] as const) {
      const bytes = thumbnails?.[size];
      if (!bytes) {
        continue;
      }
      const thumbnailPath = `${path}_${size}`;
      const thumbnailFile = this.resolvePath(thumbnailPath);
      await mkdir(dirname(thumbnailFile), { recursive: true });
      const tempThumbnail = `${thumbnailFile}.${randomUUID()}.tmp`;
      await writeFile(tempThumbnail, bytes);
      await rename(tempThumbnail, thumbnailFile);
      thumbnailPaths[size] = thumbnailPath;
    }
    const thumbnailPathJson =
      thumbnailPaths.sm || thumbnailPaths.lg ? JSON.stringify(thumbnailPaths) : null;

    await sql`
      insert into attachments
        (id, token, path, size, mimetype, hash, width, height, created_by, thumbnail_path)
      values (
        ${id},
        ${token},
        ${path},
        ${input.data.byteLength},
        ${input.mimetype},
        ${hash},
        ${input.width ?? null},
        ${input.height ?? null},
        ${this.options.actorId},
        ${thumbnailPathJson}
      )
      on conflict (token) do nothing
    `.execute(this.options.db);

    const stored = await sql<{
      id: string;
      token: string;
      path: string;
      size: number | string;
      mimetype: string;
      width: number | null;
      height: number | null;
    }>`
      select id, token, path, size, mimetype, width, height
      from attachments
      where token = ${token} and deleted_time is null
      limit 1
    `.execute(this.options.db);

    const row = stored.rows[0];
    if (!row) {
      throw new Error(`Attachment metadata was not persisted for token ${token}`);
    }

    return {
      id: row.id,
      name: input.name,
      path: row.path,
      token: row.token,
      size: Number(row.size),
      mimetype: row.mimetype,
      ...(row.width == null ? {} : { width: Number(row.width) }),
      ...(row.height == null ? {} : { height: Number(row.height) }),
    };
  }

  async read(token: string): Promise<Uint8Array> {
    const stored = await sql<{ path: string }>`
      select path
      from attachments
      where token = ${token} and deleted_time is null
      limit 1
    `.execute(this.options.db);

    const row = stored.rows[0];
    if (!row) {
      throw new Error(`Attachment not found: ${token}`);
    }

    return readFile(this.resolvePath(row.path));
  }

  async readThumbnail(token: string, size: 'sm' | 'lg' = 'sm'): Promise<Uint8Array> {
    const stored = await sql<{ thumbnailPath: string | null }>`
      select thumbnail_path as "thumbnailPath"
      from attachments
      where token = ${token} and deleted_time is null
      limit 1
    `.execute(this.options.db);

    const row = stored.rows[0];
    if (!row) {
      throw new Error(`Attachment not found: ${token}`);
    }
    if (!row.thumbnailPath) {
      throw new Error(`Attachment has no ${size} thumbnail: ${token}`);
    }
    const thumbnailPaths = JSON.parse(row.thumbnailPath) as { sm?: string; lg?: string };
    const thumbnailPath = thumbnailPaths[size];
    if (!thumbnailPath) {
      throw new Error(`Attachment has no ${size} thumbnail: ${token}`);
    }
    return readFile(this.resolvePath(thumbnailPath));
  }

  async collectGarbage(options: ILocalAttachmentGcOptions = {}): Promise<ILocalAttachmentGcResult> {
    const olderThanMs = options.olderThanMs ?? 24 * 60 * 60 * 1000;
    const limit = options.limit ?? 1000;
    const cutoff = new Date(Date.now() - olderThanMs);
    const candidates = await this.findGarbageCandidates(cutoff, limit);

    if (options.dryRun) {
      return { deleted: candidates.length, filesDeleted: 0 };
    }

    let deleted = 0;
    let filesDeleted = 0;
    for (const candidate of candidates) {
      const removed = await this.deleteGarbageCandidate(candidate.id);
      if (!removed) {
        continue;
      }
      deleted += 1;
      filesDeleted += await this.deleteStoredFiles(removed);
    }

    return { deleted, filesDeleted };
  }

  private async findGarbageCandidates(
    cutoff: Date,
    limit: number
  ): Promise<ReadonlyArray<{ id: string; token: string }>> {
    const candidates = await sql<{ id: string; token: string }>`
      select a.id, a.token
      from attachments a
      where (a.deleted_time is not null or a.created_time < ${cutoff})
        and not exists (
          select 1 from attachments_table at where at.token = a.token
        )
      order by a.created_time asc
      limit ${limit}
    `.execute(this.options.db);
    return candidates.rows;
  }

  private async deleteGarbageCandidate(
    id: string
  ): Promise<{ path: string; thumbnailPath: string | null } | undefined> {
    const removed = await sql<{ path: string; thumbnailPath: string | null }>`
      delete from attachments a
      where a.id = ${id}
        and not exists (
          select 1 from attachments_table at where at.token = a.token
        )
      returning a.path, a.thumbnail_path as "thumbnailPath"
    `.execute(this.options.db);
    return removed.rows[0];
  }

  private async deleteStoredFiles(row: {
    path: string;
    thumbnailPath: string | null;
  }): Promise<number> {
    const paths = new Set<string>([row.path]);
    if (row.thumbnailPath) {
      const thumbnailPaths = JSON.parse(row.thumbnailPath) as { sm?: string; lg?: string };
      if (thumbnailPaths.sm) paths.add(thumbnailPaths.sm);
      if (thumbnailPaths.lg) paths.add(thumbnailPaths.lg);
    }

    let filesDeleted = 0;
    for (const path of paths) {
      try {
        await unlink(this.resolvePath(path));
        filesDeleted += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
    return filesDeleted;
  }

  private resolvePath(path: string): string {
    const root = resolve(this.options.rootDir);
    const filePath = resolve(root, path);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      throw new Error(`Attachment path escapes the storage root: ${path}`);
    }
    return filePath;
  }
}
