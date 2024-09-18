import type { IGetTokenRo } from '../../../../api';
import { getTokenRoSchema } from '../../../../api';
import { fetchBasePermissions } from '../../backend';
import { getToken } from './uilts';

export async function POST(request: Request) {
  const body: IGetTokenRo = await request.json();
  const { baseId, pluginId } = body;
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
  const basePermissions = await fetchBasePermissions(baseId, cookie);
  if (!basePermissions.success) {
    return Response.json(
      { error: `fetchBasePermissions: ${basePermissions.error}` },
      { status: 401 }
    );
  }
  if (!basePermissions.data['base|read']) {
    return Response.json({ error: `can't read base(${baseId})` }, { status: 401 });
  }

  const res = await getToken(pluginId, baseId, cookie);
  if (!res.success) {
    return Response.json({ error: `getToken: ${res.error}` }, { status: 401 });
  }
  return Response.json({
    accessToken: res.data.accessToken,
  });
}
