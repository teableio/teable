import { registerRoute } from '../utils';
import { z } from '../zod';

export enum Task {
  Coding = 'coding',
  Embedding = 'embedding',
  Translation = 'translation',
}

export const AI_GENERATE_STREAM = '/api/ai/generate-stream';

export const aiGenerateRoSchema = z.object({
  prompt: z.string(),
  task: z.nativeEnum(Task).optional(),
  baseId: z.string(),
});

export type IAiGenerateRo = z.infer<typeof aiGenerateRoSchema>;

export const aiGenerateVoSchema = z.object({
  result: z.string(),
});

export type IAiGenerateVo = z.infer<typeof aiGenerateVoSchema>;

export const aiGenerateRoute = registerRoute({
  method: 'post',
  path: AI_GENERATE_STREAM,
  description: 'Generate ai stream',
  request: {
    body: {
      content: {
        'application/json': {
          schema: aiGenerateRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns ai generate stream.',
      content: {
        'application/json': {
          schema: aiGenerateVoSchema,
        },
      },
    },
  },
  tags: ['ai'],
});

export const aiGenerateStream = (aiGenerateRo: IAiGenerateRo, signal?: AbortSignal) => {
  return fetch(AI_GENERATE_STREAM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(aiGenerateRo),
    signal,
  });
};
