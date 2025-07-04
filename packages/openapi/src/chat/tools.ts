import { z } from '../zod';

export const dataVisualizationParametersSchema = z.object({
  question: z
    .string()
    .describe(
      "The user's question, please describe the problem and requirements as clearly as possible, and provide complete and detailed context"
    ),
  filePath: z
    .string()
    .optional()
    .describe(
      'The path of previously generated visualization HTML file. If provided, the system will update the existing visualization instead of creating a new one.'
    ),
  title: z.string().describe('The title of the data visualization page'),
  visualizationData: z
    .string()
    .describe('The visualization data, please provide the data in the format of JSON.'),
});

export type IDataVisualizationParameters = z.infer<typeof dataVisualizationParametersSchema>;
