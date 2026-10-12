import { HttpError, HttpErrorCode } from '@teable/core';
import ShareDB from 'sharedb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from './auth.middleware';
import { ShareDbAdapter } from './share-db.adapter';

interface IWireReply {
  a: string;
  error?: { code: string; message: string };
}

const fixtures: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of fixtures.splice(0)) await dispose();
});

async function queryWithError(error: HttpError) {
  const cls = {
    get: () => ({}),
    runWith: (_store: unknown, run: () => Promise<void>) => run(),
  };
  const records = {
    getDocIdsByQuery: async () => {
      throw error;
    },
  };
  const adapter = new ShareDbAdapter(
    cls as never,
    {} as never,
    records as never,
    {} as never,
    {} as never,
    {} as never
  );
  const backend = new ShareDB({ db: adapter });
  authMiddleware(backend);
  const replies: IWireReply[] = [];
  // Capture the installed server's actual reply after getReplyErrorObject, not
  // the adapter callback. JSON round-trip matches the WebSocket payload boundary.
  backend.on('send', (_agent, message) => {
    if (message.a === 'qf') replies.push(JSON.parse(JSON.stringify(message)));
  });
  const connection = backend.connect(undefined, {
    headers: { cookie: 'session=error-transport' },
    url: '/socket',
  });
  fixtures.push(async () => {
    connection.close();
    await new Promise<void>((resolve, reject) => {
      backend.close((closeError) => (closeError ? reject(closeError) : resolve()));
    });
  });
  await vi.waitFor(() => expect(connection.state).toBe('connected'));
  const clientError = await new Promise<Error | null | undefined>((resolve) => {
    connection.createFetchQuery('rec_tblPending', {}, {}, (queryError) => resolve(queryError));
  });
  return { replies, clientError };
}

describe('ShareDbAdapter error transport (installed server and client)', () => {
  it('preserves the pending identity through normalization and socket serialization', async () => {
    const { replies, clientError } = await queryWithError(
      new HttpError(
        {
          message: 'Physical table is not ready',
          code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
          data: {
            domainCode: 'table.provision_pending',
            details: { tableId: 'tblPending' },
          },
        },
        503
      )
    );

    expect(replies).toEqual([
      expect.objectContaining({
        a: 'qf',
        error: {
          code: 'table.provision_pending',
          message: 'Physical table is not ready',
        },
      }),
    ]);
    expect(clientError).toMatchObject({
      code: 'table.provision_pending',
      message: 'Physical table is not ready',
    });
  });

  it('does not classify an ordinary database outage as pending from its message', async () => {
    const { replies, clientError } = await queryWithError(
      new HttpError(
        {
          message: 'Physical table is not ready',
          code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
          data: { domainCode: 'database.connection_unavailable' },
        },
        503
      )
    );

    expect(replies).toEqual([
      expect.objectContaining({
        error: {
          code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
          message: 'Physical table is not ready',
        },
      }),
    ]);
    expect(clientError).toMatchObject({
      code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
    });
  });
});
