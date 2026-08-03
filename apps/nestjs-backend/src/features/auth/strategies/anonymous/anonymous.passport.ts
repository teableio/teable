/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DeserializeUserFunction } from 'passport';
import { Strategy } from 'passport';
import { ANONYMOUS_STRATEGY_NAME } from '../constant';

export class PassportAnonymousStrategy extends Strategy {
  public name: string;
  private _deserializeUser: DeserializeUserFunction;

  constructor(deserializeUser?: DeserializeUserFunction) {
    super();
    this.name = ANONYMOUS_STRATEGY_NAME;
    this._deserializeUser = deserializeUser!;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  authenticate(req: any): void {
    const { success, fail } = this;
    this._deserializeUser(undefined, req, function (err, user) {
      if (err) {
        return fail(err?.message || 'No template user found');
      }
      if (!user) {
        fail('No template user found');
      } else {
        success(user);
      }
    });
  }
}
