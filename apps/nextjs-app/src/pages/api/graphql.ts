import {
  ApolloServerPluginLandingPageLocalDefault,
  ApolloServerPluginLandingPageProductionDefault,
} from 'apollo-server-core';
import { ApolloServer } from 'apollo-server-micro';
import type { NextApiRequest, NextApiResponse } from 'next';
import { graphqlSdlContext } from '@/backend/api/graphql-sdl/graphql-sdl-context';
import { graphqlSdlSchema } from '@/backend/api/graphql-sdl/graphql-sdl-schema';

const apolloServer = new ApolloServer({
  typeDefs: graphqlSdlSchema.typeDefs,
  resolvers: graphqlSdlSchema.resolvers,
  context: graphqlSdlContext,
  plugins: [
    process.env.NODE_ENV === 'production'
      ? ApolloServerPluginLandingPageProductionDefault({
          // graphRef: 'graphql-sdl@nextjs-monorepo-example',
          footer: false,
        })
      : ApolloServerPluginLandingPageLocalDefault({ footer: false }),
  ],
});

export const config = {
  api: {
    bodyParser: false,
  },
};

const startServer = apolloServer.start();

export default async function handleGraphQl(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader(
    'Access-Control-Allow-Origin',
    'https://studio.apollographql.com'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Vary'
  );
  if (req.method === 'OPTIONS') {
    res.end();
    return false;
  }

  await startServer;
  await apolloServer.createHandler({
    path: '/api/graphql-sdl',
  })(req, res);
}
