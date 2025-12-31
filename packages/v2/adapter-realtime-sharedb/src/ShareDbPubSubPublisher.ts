import { domainError, type DomainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { PubSub } from 'sharedb';

import type { IShareDbOpPublisher, ShareDbOp } from './ShareDbPublisher';

type ShareDbPubSub = Pick<PubSub, 'publish'>;

export class ShareDbPubSubPublisher implements IShareDbOpPublisher {
  constructor(private readonly pubsub: ShareDbPubSub) {}

  async publish(
    channels: ReadonlyArray<string>,
    op: ShareDbOp
  ): Promise<Result<void, DomainError>> {
    const channelList = [...channels];
    return new Promise((resolve) => {
      this.pubsub.publish(channelList, op, (error) => {
        if (!error) {
          resolve(ok(undefined));
          return;
        }
        if (error instanceof Error) {
          resolve(err(domainError.fromUnknown(error)));
          return;
        }
        resolve(err(domainError.unexpected({ message: 'ShareDB publish failed' })));
      });
    });
  }
}
