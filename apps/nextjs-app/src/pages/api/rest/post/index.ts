import { HttpMethodNotAllowed } from '@belgattitude/http-exception';
import { JsonApiResponseFactory } from '@teable-group/sdk/api/json-api';
import { JsonApiErrorFactory } from '@teable-group/sdk/api/json-api/json-api-error.factory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { PostRepositorySsr } from '@/backend/api/rest/post-repository.ssr';
import { prismaClient } from '@/backend/config/container.config';

export default async function handleListPosts(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const postRepo = new PostRepositorySsr(prismaClient);
    try {
      return res.json(
        JsonApiResponseFactory.fromSuccess(
          await postRepo.getPosts({
            limit: 100,
          })
        )
      );
    } catch (e) {
      const apiError = JsonApiErrorFactory.fromCatchVariable(e);
      return res.status(apiError.status ?? 500).json(JsonApiResponseFactory.fromError(apiError));
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
