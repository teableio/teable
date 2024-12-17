import { Injectable } from '@nestjs/common';

@Injectable()
export class SessionService {
  async signout(req: Express.Request) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy(function (err) {
        // cannot access session here
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}
