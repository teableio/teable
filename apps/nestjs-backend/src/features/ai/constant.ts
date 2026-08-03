/* eslint-disable @typescript-eslint/naming-convention */
import { Task } from '@teable/openapi';

export const TASK_MODEL_MAP = {
  [Task.Coding]: 'chatModel.lg',
  [Task.Embedding]: 'embeddingModel',
  [Task.Translation]: 'translationModel',
};
