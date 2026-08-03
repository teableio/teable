/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SessionStrategyOptions, DeserializeUserFunction } from 'passport';
import { Strategy } from 'passport';
import pause from 'pause';

export class PassportSessionStrategy extends Strategy {
  public name: string;
  private _key: string;
  private _deserializeUser: DeserializeUserFunction;

  constructor(options?: SessionStrategyOptions, deserializeUser?: DeserializeUserFunction) {
    if (typeof options === 'function') {
      deserializeUser = options;
      options = undefined;
    }
    super();
    this.name = 'session';
    this._key = options?.key || 'passport';
    this._deserializeUser = deserializeUser!;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  authenticate(req: any, options?: { pauseStream?: boolean }): void {
    if (!req.session) {
      return this.error(new Error('No session'));
    }
    options = options || {};

    const { success, fail, _key, _deserializeUser } = this;
    const user: any = req.session?.[_key]?.user;

    if (user) {
      const paused = options.pauseStream ? pause(req) : null;

      _deserializeUser(user, req, function (err, user) {
        if (err) {
          return fail(err);
        }
        if (!user) {
          delete req.session[_key].user;
          fail('No user session found');
        } else {
          const property = req._userProperty || 'user';
          req[property] = user;
          success(user);
        }
        if (paused) {
          paused.resume();
        }
      });
    } else {
      fail('No user');
    }
  }
}
