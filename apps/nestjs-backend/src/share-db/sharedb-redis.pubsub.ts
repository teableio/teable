/* eslint-disable @typescript-eslint/naming-convention */
import Redis from 'ioredis';
import type { Error as ShareDBError } from 'sharedb';
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

    const isDev = process.env.NODE_ENV === 'development';

    const devRedisOptions = {
      retryStrategy(times: number) {
        if (times > 20) {
          console.error('Redis connection retry limit exceeded');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: null,
      reconnectOnError(err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return (
          message.includes('Connection is closed') ||
          message.includes('READONLY') ||
          message.includes('ECONNRESET') ||
          message.includes('ETIMEDOUT') ||
          message.includes('ENOTFOUND')
        );
      },
      autoResendUnfulfilledCommands: true,
      autoResubscribe: true,
      connectTimeout: 10000,
      commandTimeout: 5000,
      enableReadyCheck: true,
      enableOfflineQueue: true,
      lazyConnect: false,
    };

    this.client = isDev
      ? new Redis(options.redisURI, devRedisOptions)
      : new Redis(options.redisURI);

    // Redis doesn't allow the same connection to both listen to channels and do
    // operations. Make an extra redis connection for subscribing with the same
    // options if not provided
    this.observer = isDev
      ? new Redis(options.redisURI, devRedisOptions)
      : new Redis(options.redisURI);

    if (isDev) {
      this.setupConnectionListeners(this.client, 'client');
      this.setupConnectionListeners(this.observer, 'observer');
    }

    this.observer.on('message', this.handleMessage.bind(this));
  }

  private setupConnectionListeners(redis: Redis, name: string): void {
    redis.on('connect', () => {
      console.log(`[ShareDB Redis ${name}] Connecting...`);
    });

    redis.on('ready', () => {
      console.log(`[ShareDB Redis ${name}] Ready`);
    });

    redis.on('error', (err) => {
      console.error(`[ShareDB Redis ${name}] Error:`, err.message);
    });

    redis.on('close', () => {
      console.warn(`[ShareDB Redis ${name}] Connection closed`);
    });

    redis.on('reconnecting', (delay: number) => {
      console.log(`[ShareDB Redis ${name}] Reconnecting in ${delay}ms...`);
    });

    redis.on('end', () => {
      console.warn(`[ShareDB Redis ${name}] Connection ended`);
    });
  }

  close(
    callback = function (err: ShareDBError | null) {
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

  _subscribe(channel: string, callback: (err: ShareDBError | null) => void): void {
    this.observer.subscribe(channel).then(function () {
      callback(null);
    }, callback);
  }

  handleMessage(channel: string, message: string) {
    this._emit(channel, JSON.parse(message));
  }

  _unsubscribe(channel: string, callback: (err: ShareDBError | null) => void): void {
    this.observer.unsubscribe(channel).then(function () {
      callback(null);
    }, callback);
  }

  async _publish(channels: string[], data: unknown, callback: (err: ShareDBError | null) => void) {
    const message = JSON.stringify(data);
    const args = [message].concat(channels);
    this.client.eval(PUBLISH_SCRIPT, 0, ...args).then(function () {
      callback(null);
    }, callback);
  }
}
