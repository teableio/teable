import crypto from 'crypto';
import { Injectable } from '@nestjs/common';

const pkceMethod = 'S256' as const;
const pkceChallengePattern = /^[\w-]{43,128}$/;
const pkceVerifierPattern = /^[\w.~-]{43,128}$/;

export interface IPkceAuthorizeParams {
  codeChallenge: string;
  codeChallengeMethod: typeof pkceMethod;
}

@Injectable()
export class PkceService {
  isValidCodeChallenge(codeChallenge: string): boolean {
    return pkceChallengePattern.test(codeChallenge);
  }

  isValidCodeVerifier(codeVerifier: string): boolean {
    return pkceVerifierPattern.test(codeVerifier);
  }

  validateCodeVerifier(
    codeChallenge: string,
    codeChallengeMethod: string | undefined,
    codeVerifier: string
  ): boolean {
    if (codeChallengeMethod !== pkceMethod || !this.isValidCodeVerifier(codeVerifier)) {
      return false;
    }
    const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    if (hash.length !== codeChallenge.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(codeChallenge));
  }

  isLoopbackMatch(registered: string, requested: string): boolean {
    try {
      const reg = new URL(registered);
      const req = new URL(requested);
      const loopbackHosts = ['127.0.0.1', '[::1]', 'localhost'];
      if (
        reg.protocol === req.protocol &&
        loopbackHosts.includes(reg.hostname) &&
        loopbackHosts.includes(req.hostname) &&
        reg.pathname === req.pathname
      ) {
        return true; // ignore port for loopback
      }
      return registered === requested;
    } catch {
      return false;
    }
  }
}
