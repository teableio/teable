import type { IJsonApiResponse } from '@teable-group/core';
import { isJsonApiSuccessResponse } from '@teable-group/core';
import { ky } from '@/config/ky';

interface ITextFileContent {
  content: string;
}
export const fetchFileContent = async (path: string): Promise<ITextFileContent> => {
  return ky
    .get(`/api/file-content/${path}`)
    .json<IJsonApiResponse<ITextFileContent>>()
    .then((resp) => {
      if (!isJsonApiSuccessResponse(resp)) {
        throw new Error(`Error fetching posts: ${JSON.stringify(resp.errors)}`);
      }
      return resp.data;
    });
};
