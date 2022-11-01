import { gql } from 'apollo-server-micro';
import { SearchPoemsQuery } from '@/backend/features/poem/SearchPoems';
import type { GraphqlSdlContext } from './graphql-sdl-context';

const typeDefs = gql`
  type Poem {
    id: Int!
    title: String
    content: String
    author: String
    keywords: [String]
  }
  type Query {
    searchPoems: [Poem!]!
  }
`;

const resolvers = {
  Query: {
    searchPoems: (
      _parent: unknown,
      _args: {
        limit?: number;
        offset?: number;
      },
      context: GraphqlSdlContext
    ) => {
      const poemQuery = new SearchPoemsQuery(context.prisma);
      return poemQuery.execute({
        limit: _args.limit,
        offset: _args.offset,
      });
    },
  },
};

export const graphqlSdlSchema = {
  resolvers,
  typeDefs,
};
