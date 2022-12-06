import type { JsonApiResponse } from '@teable-group/sdk/api/json-api';
import { isJsonApiSuccessResponse } from '@teable-group/sdk/api/json-api';
import axios from 'axios';
import type { IGetPosts } from '@/_backend/api/rest/post-repository.ssr';

export const fetchPostsWithAxios = async (): Promise<IGetPosts> => {
  return axios
    .get<JsonApiResponse<IGetPosts>>('/api/rest/post', {
      responseType: 'json',
    })
    .then((resp) => {
      const payload = resp.data;
      if (!isJsonApiSuccessResponse(payload)) {
        throw new Error(`Error fetching posts: ${JSON.stringify(payload.errors)}`);
      }
      return payload.data;
    });
};
