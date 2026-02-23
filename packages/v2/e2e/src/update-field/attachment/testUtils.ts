/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import type { SharedTestContext } from '../../shared/globalTestContext';

export type SeededAttachment = {
  token: string;
  path: string;
  size: number;
  mimetype: string;
};

export const ensureAttachmentTables = async (ctx: SharedTestContext) => {
  await sql`
    create table if not exists attachments (
      id text primary key,
      token text unique not null,
      hash text not null,
      size int not null,
      mimetype text not null,
      path text not null,
      width int,
      height int,
      deleted_time timestamptz,
      created_time timestamptz default now(),
      created_by text not null,
      last_modified_by text,
      thumbnail_path text
    )
  `.execute(ctx.testContainer.db);
};

export const seedAttachment = async (ctx: SharedTestContext): Promise<SeededAttachment> => {
  const token = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `table/${Math.random().toString(36).slice(2, 12)}`;
  const size = 128;
  const mimetype = 'text/plain';

  await sql`
    insert into attachments (id, token, hash, size, mimetype, path, created_by)
    values (
      ${`att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`},
      ${token},
      ${'hash'},
      ${size},
      ${mimetype},
      ${path},
      ${ctx.testUser.id}
    )
    on conflict (token) do nothing
  `.execute(ctx.testContainer.db);

  return { token, path, size, mimetype };
};

export const makeAttachmentCell = (seeded: SeededAttachment, name = 'file.txt') => [
  {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    token: seeded.token,
    path: seeded.path,
    size: seeded.size,
    mimetype: seeded.mimetype,
  },
];
