import { createServer } from '@graphql-yoga/node';
import { getBuiltMesh } from '@teable-group/api-gateway';
import type { NextApiRequest, NextApiResponse } from 'next';

async function buildServer() {
  const mesh = await getBuiltMesh();
  return createServer({
    plugins: mesh.plugins,
    graphiql: {
      endpoint: '/api/gateway/graphql',
      title: 'GraphQL Gateway',
    },
  });
}

const server$ = buildServer();

export default async function apiHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return (await server$).requestListener(req, res);
}
