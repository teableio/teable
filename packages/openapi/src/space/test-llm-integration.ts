import type { ITestLLMRo, ITestLLMVo } from '../admin';
import { axios } from '../axios';
import { urlBuilder } from '../utils';

export const TEST_INTEGRATION_LLM = '/space/{spaceId}/test-llm';

export const testIntegrationLLM = async (
  spaceId: string,
  data: ITestLLMRo
): Promise<ITestLLMVo> => {
  const response = await axios.post<ITestLLMVo>(
    urlBuilder(TEST_INTEGRATION_LLM, { spaceId }),
    data
  );
  return response.data;
};
