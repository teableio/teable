import { HttpMethodNotAllowed } from '@belgattitude/http-exception';
import { JsonApiResponseFactory } from '@teable-group/core-lib/api/json-api';
import { JsonApiErrorFactory } from '@teable-group/core-lib/api/json-api/json-api-error.factory';
import type { NextApiRequest, NextApiResponse } from 'next';
import superjson from 'superjson';
import { prismaClient } from '@/_backend/config/container.config';
import { SearchPoemsQuery } from '@/_backend/features/poem/SearchPoems';

export default async function handleListPoems(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    const searchPoem = new SearchPoemsQuery(prismaClient);
    try {
      const { json: serializableData, meta } = superjson.serialize(
        await searchPoem.execute({
          limit: 100,
        })
      );
      return res.json(
        JsonApiResponseFactory.fromSuccess(serializableData, {
          serializer: 'superjson',
          superjsonMeta: meta ?? {},
        })
      );
    } catch (e) {
      const apiError = JsonApiErrorFactory.fromCatchVariable(e);
      return res
        .status(apiError.status ?? 500)
        .json(JsonApiResponseFactory.fromError(apiError));
    }
  } else {
    return res
      .status(HttpMethodNotAllowed.STATUS)
      .json(
        JsonApiResponseFactory.fromError(
          `The HTTP ${req.method} method is not supported at this route.`,
          HttpMethodNotAllowed.STATUS
        )
      );
  }
}
