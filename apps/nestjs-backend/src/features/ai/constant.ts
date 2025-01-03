/* eslint-disable @typescript-eslint/naming-convention */
import { Task } from '@teable/openapi';

export const TASK_MODEL_MAP = {
  [Task.Coding]: 'codingModel',
  [Task.Embedding]: 'embeddingModel',
  [Task.Translation]: 'translationModel',
};
