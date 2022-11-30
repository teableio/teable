import type { JsonApiResponse } from '@teable-group/core-lib/api/json-api';
import { isJsonApiSuccessResponse } from '@teable-group/core-lib/api/json-api';
import { ky } from '@/config/ky';

interface ITextFileContent {
  content: string;
}
export const fetchFileContent = async (
  path: string
): Promise<ITextFileContent> => {
  return ky
    .get(`/api/fileContent/${path}`)
    .json<JsonApiResponse<ITextFileContent>>()
    .then((resp) => {
      if (!isJsonApiSuccessResponse(resp)) {
        throw new Error(`Error fetching posts: ${JSON.stringify(resp.errors)}`);
      }
      return resp.data;
    });
};
