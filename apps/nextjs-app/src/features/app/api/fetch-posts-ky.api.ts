import type { JsonApiResponse } from '@teable-group/sdk/api/json-api';
import { isJsonApiSuccessResponse } from '@teable-group/sdk/api/json-api';
import type { IGetPosts } from '@/_backend/api/rest/post-repository.ssr';
import { ky } from '@/config/ky';

export const fetchPostsWithKy = async (): Promise<IGetPosts> => {
  return ky
    .get('/api/rest/post')
    .json<JsonApiResponse<IGetPosts>>()
    .then((resp) => {
      if (!isJsonApiSuccessResponse(resp)) {
        throw new Error(`Error fetching posts: ${JSON.stringify(resp.errors)}`);
      }
      return resp.data;
    });
};
