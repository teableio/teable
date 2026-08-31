import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authenticates the OAuth *client* on the token endpoint and leaves the
 * session alone. This guard used to call `logIn()`, which persisted a session
 * per cookieless token call — the serializer stored `{id: undefined}` (a
 * client has no `id`), so the sessions were unusable, piled up under one
 * `auth:session-user:undefined` map for their 7-day TTL, and a polling device
 * grant minted one per poll. Nothing on the token leg reads the session:
 * oauth2orize transactions live in the cache store and both exchanges only
 * read `req.user`, which `canActivate` sets without a session.
 */
@Injectable()
export class OAuthClientGuard extends AuthGuard(['oauth2-client-password', 'oauth2-pkce-client']) {}
