import { z } from 'zod';

export const GET_TOKEN_URL = '/api/plugin/getToken';
export const getTokenRoSchema = z.object({
  baseId: z.string(),
  pluginId: z.string(),
});
export type IGetTokenRo = z.infer<typeof getTokenRoSchema>;

export type IGetTokenVo = {
  accessToken: string;
};

export const fetchGetToken = async (data: IGetTokenRo) => {
  const res = await fetch(`/plugin/chart/api/plugin/getToken`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.json() as Promise<IGetTokenVo>;
};
