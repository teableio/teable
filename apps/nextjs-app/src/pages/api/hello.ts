import { sayHello } from '@teable-group/sdk';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handleApiHelloRoute(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return res.send(sayHello('world loaded from /api/hello'));
}
