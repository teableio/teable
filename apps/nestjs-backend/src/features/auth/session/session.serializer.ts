/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor() {
    super();
  }

  serializeUser(user: any, done: Function) {
    done(null, { id: user.id });
  }

  async deserializeUser(payload: any, done: Function) {
    done(null, payload);
  }
}
