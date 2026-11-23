export const requestPublicOrpc = (
  appUrl: string,
  path: string,
  input: Record<string, unknown>,
  options: { method?: 'GET' | 'POST' | 'DELETE'; headers?: HeadersInit } = {}
) => {
  const method = options.method ?? 'POST';
  const url = new URL(`${appUrl}/api/v2${path}`);
  if (method === 'GET') {
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
    }
  }
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  return fetch(url, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: JSON.stringify(input) }),
  });
};

export const responseCookie = (response: Response): string => {
  const cookies = response.headers.getSetCookie();
  if (!cookies.length) throw new Error('Authentication response did not set a cookie');
  return cookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
};

/** Sign in over HTTP so the test exercises Passport and the persisted session. */
export const signInPublicHost = async (appUrl: string): Promise<string> => {
  const response = await fetch(`${appUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: globalThis.testConfig.email,
      password: globalThis.testConfig.password,
    }),
  });
  if (!response.ok) throw new Error(`HTTP signin failed (${response.status}): ${await response.text()}`);
  return responseCookie(response);
};

/** Attach credentials to the request, never an execution context or caller actor. */
export const authenticatedPublicFetch = (headers: HeadersInit): typeof fetch => {
  const authenticatedFetch: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    for (const [name, value] of new Headers(headers)) request.headers.set(name, value);
    return fetch(request);
  };
  return authenticatedFetch;
};

/** Axios exposes Set-Cookie as an array; send only cookie pairs on requests. */
export const sessionCookie = (value: unknown): string => {
  const cookies = Array.isArray(value) ? value : [String(value ?? '')];
  return cookies.map((cookie: string) => cookie.split(';', 1)[0]).join('; ');
};
