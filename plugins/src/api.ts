import { z } from 'zod';

export enum GetTokenType {
  chart = 'chart',
}

export const GET_TOKEN_URL = '/api/plugin/getToken';
export const getTokenRoSchema = z.object({
  baseId: z.string(),
  pluginId: z.string(),
  type: z.nativeEnum(GetTokenType),
});

export type IGetTokenRo = z.infer<typeof getTokenRoSchema>;

export type IGetTokenVo = {
  accessToken: string;
};

export const fetchGetToken = async (
  data: IGetTokenRo,
  opts?: {
    cookie?: string;
    baseUrl?: string;
  }
) => {
  const res = await fetch(`${opts?.baseUrl || ''}/plugin/api/plugin/getToken`, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: opts?.cookie ? { cookie: opts.cookie } : undefined,
  });
  return res.json() as Promise<IGetTokenVo>;
};
