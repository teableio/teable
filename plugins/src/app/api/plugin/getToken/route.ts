import type { Action } from '@teable/core';
import type { IGetTokenRo } from '../../../../api';
import { getTokenRoSchema, GetTokenType } from '../../../../api';
import { AuthRequest } from '../../backend';

const baseURL = process.env.PLUGIN_TEABLE_BACKEND_BASE_URL || 'http://127.0.0.1:3000/api';
const chartSecret = process.env.PLUGIN_CHART_SECRET || process.env.SECRET_KEY || 'defaultSecretKey';

const authRequest = new AuthRequest();

const typeMap: {
  [key in GetTokenType]: {
    scopes: Action[];
    secret: string;
  };
} = {
  [GetTokenType.chart]: {
    scopes: ['base|query_data'],
    secret: chartSecret,
  },
};

export async function POST(request: Request) {
  const body: IGetTokenRo = await request.json();
  const { baseId, pluginId, type } = body;
  const { scopes, secret } = typeMap[type];
  authRequest.baseUrl = baseURL;
  authRequest.secret = secret;
  const valid = getTokenRoSchema.safeParse(body);
  if (!valid.success) {
    return Response.json({ error: valid.error }, { status: 400 });
  }

  const cookie = request.headers.get('cookie');
  // validate the cookie
  if (!cookie) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // validate the cookie base permission
  const basePermissions = await authRequest.fetchBasePermissions(baseId, cookie);
  if (!basePermissions.success) {
    return Response.json(
      { error: `fetchBasePermissions: ${basePermissions.error}` },
      { status: 401 }
    );
  }
  if (!basePermissions.data['base|read']) {
    return Response.json({ error: `can't read base(${baseId})` }, { status: 401 });
  }

  const res = await authRequest.getToken(pluginId, baseId, cookie, scopes);
  if (!res.success) {
    return Response.json({ error: `getToken: ${res.error}` }, { status: 401 });
  }
  return Response.json({
    accessToken: res.data.accessToken,
  });
}
