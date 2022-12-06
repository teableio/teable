import type { JsonApiResponse } from '@teable-group/sdk/api/json-api';
import { isJsonApiSuccessResponse } from '@teable-group/sdk/api/json-api';
import { ky } from '@/config/ky';

interface ITextFileContent {
  content: string;
}
export const fetchFileContent = async (path: string): Promise<ITextFileContent> => {
  return ky
    .get(`/api/file-content/${path}`)
    .json<JsonApiResponse<ITextFileContent>>()
    .then((resp) => {
      if (!isJsonApiSuccessResponse(resp)) {
        throw new Error(`Error fetching posts: ${JSON.stringify(resp.errors)}`);
      }
      return resp.data;
    });
};
