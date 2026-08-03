import { HttpErrorCode } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { ShareSocketService } from './share-socket.service';

const createService = () => new ShareSocketService({} as never, {} as never, {} as never);

describe('ShareSocketService computed activity authorization', () => {
  it('allows activity for the shared table', () => {
    const service = createService();

    expect(() =>
      service.authorizeComputedActivityRead(
        { shareId: 'shrTest', tableId: 'tblShared' },
        'tblShared'
      )
    ).not.toThrow();
  });

  it('rejects activity for a different table', () => {
    const service = createService();

    expect(() =>
      service.authorizeComputedActivityRead(
        { shareId: 'shrTest', tableId: 'tblShared' },
        'tblOther'
      )
    ).toThrowError(
      expect.objectContaining({
        code: HttpErrorCode.RESTRICTED_RESOURCE,
        message: 'Table(tblOther) permission not allowed: read',
      })
    );
  });
});
