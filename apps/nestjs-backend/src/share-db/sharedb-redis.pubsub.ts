/* eslint-disable @typescript-eslint/naming-convention */
import Redis from 'ioredis';
import type { Error } from 'sharedb';
import { PubSub } from 'sharedb';

const PUBLISH_SCRIPT = 'for i = 2, #ARGV do ' + 'redis.call("publish", ARGV[i], ARGV[1]) ' + 'end';

// Redis pubsub driver for ShareDB.
//
// The redis driver requires two redis clients (a single redis client can't do
// both pubsub and normal messaging). These clients will be created
// automatically if you don't provide them.
export class RedisPubSub extends PubSub {
  client: Redis;
  observer: Redis;
  _closing?: boolean;

  constructor(options: { redisURI: string; prefix?: string }) {
    super(options);

    this.client = new Redis(options.redisURI);

    // Redis doesn't allow the same connection to both listen to channels and do
    // operations. Make an extra redis connection for subscribing with the same
    // options if not provided
    this.observer = new Redis(options.redisURI);
    this.observer.on('message', this.handleMessage.bind(this));
  }

  close(
    callback = function (err: Error | null) {
      if (err) throw err;
    }
  ): void {
    PubSub.prototype.close.call(this, (err) => {
      if (err) return callback(err);
      this._close().then(function () {
        callback(null);
      }, callback);
    });
  }

  async _close() {
    if (this._closing) {
      return;
    }
    this._closing = true;
    this.observer.removeAllListeners();
    await Promise.all([this.client.quit(), this.observer.quit()]);
  }

  _subscribe(channel: string, callback: (err: Error | null) => void): void {
    this.observer.subscribe(channel).then(function () {
      callback(null);
    }, callback);
  }

  handleMessage(channel: string, message: string) {
    this._emit(channel, JSON.parse(message));
  }

  _unsubscribe(channel: string, callback: (err: Error | null) => void): void {
    this.observer.unsubscribe(channel).then(function () {
      callback(null);
    }, callback);
  }

  async _publish(channels: string[], data: unknown, callback: (err: Error | null) => void) {
    const message = JSON.stringify(data);
    const args = [message].concat(channels);
    this.client.eval(PUBLISH_SCRIPT, 0, ...args).then(function () {
      callback(null);
    }, callback);
  }
}
