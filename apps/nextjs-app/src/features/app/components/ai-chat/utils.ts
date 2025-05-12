export const getCreditUsage = (
  promptTokens: number,
  completionTokens: number,
  modelOptions: {
    inputRate?: number;
    outputRate?: number;
  }
) => {
  const { inputRate = 0.01, outputRate = 0.01 } = modelOptions;
  return Math.ceil(promptTokens * inputRate + completionTokens * outputRate);
};
