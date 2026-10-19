import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import { LOG_REDACT_PATHS, REDACTED, redactQuery, redactUrl } from './redact';

describe('redactUrl', () => {
  it('leaves urls without a query string untouched', () => {
    expect(redactUrl('/api/table/tbl123/record')).toBe('/api/table/tbl123/record');
    expect(redactUrl('/api/auth/callback?')).toBe('/api/auth/callback?');
  });

  it('redacts sensitive query values and keeps everything else', () => {
    expect(redactUrl('/api/auth/google/callback?code=4%2F0Abc&state=xyz&scope=email+profile')).toBe(
      `/api/auth/google/callback?code=${REDACTED}&state=xyz&scope=email+profile`
    );
    expect(
      redactUrl(
        '/x?token=t&access_token=a&refresh_token=r&signature=s&key=k&password=p&take=10&skip=0'
      )
    ).toBe(
      `/x?token=${REDACTED}&access_token=${REDACTED}&refresh_token=${REDACTED}` +
        `&signature=${REDACTED}&key=${REDACTED}&password=${REDACTED}&take=10&skip=0`
    );
  });

  it('matches keys case-insensitively, url-encoded, and by token/secret/password suffix', () => {
    expect(redactUrl('/x?Token=a&ACCESS_TOKEN=b&X-Amz-Signature=c&inviteToken=d&q=1')).toBe(
      `/x?Token=${REDACTED}&ACCESS_TOKEN=${REDACTED}&X-Amz-Signature=${REDACTED}` +
        `&inviteToken=${REDACTED}&q=1`
    );
    expect(redactUrl('/x?access%5Ftoken=a&sharePassword=b')).toBe(
      `/x?access%5Ftoken=${REDACTED}&sharePassword=${REDACTED}`
    );
  });

  it('keeps flags without a value, empty values and the fragment', () => {
    expect(redactUrl('/x?debug&token=&code=abc#section')).toBe(
      `/x?debug&token=${REDACTED}&code=${REDACTED}#section`
    );
  });

  it('works on absolute urls', () => {
    expect(redactUrl('https://app.teable.ai/invite?code=abc&lang=en')).toBe(
      `https://app.teable.ai/invite?code=${REDACTED}&lang=en`
    );
  });
});

describe('redactQuery', () => {
  it('redacts sensitive keys of a parsed query object', () => {
    expect(redactQuery({ token: 'a', refreshToken: 'b', viewId: 'viw1' })).toEqual({
      token: REDACTED,
      refreshToken: REDACTED,
      viewId: 'viw1',
    });
  });

  it('passes non-objects through', () => {
    expect(redactQuery(undefined)).toBeUndefined();
    expect(redactQuery('token=a')).toBe('token=a');
  });
});

describe('LOG_REDACT_PATHS', () => {
  it('is accepted by pino and censors sensitive fields', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const { logger } = pinoHttp({ redact: { paths: LOG_REDACT_PATHS, censor: REDACTED } }, stream);

    logger.info(
      {
        password: 'p',
        user: { id: 'usr1', apiKey: 'k' },
        req: {
          url: '/x',
          headers: { authorization: 'Bearer t', cookie: 'auth_session=s' },
        },
        body: { token: 't', name: 'n' },
        err: { config: { headers: { Authorization: 'Bearer t' } } },
      },
      'hello'
    );

    const log = JSON.parse(lines[0]);
    expect(log.password).toBe(REDACTED);
    expect(log.user).toEqual({ id: 'usr1', apiKey: REDACTED });
    expect(log.req.headers).toEqual({ authorization: REDACTED, cookie: REDACTED });
    expect(log.body).toEqual({ token: REDACTED, name: 'n' });
    expect(log.err.config.headers.Authorization).toBe(REDACTED);
    expect(log.req.url).toBe('/x');
  });
});
