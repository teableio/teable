import z from 'zod';
import { ViewType } from './constant';
import { kanbanViewOptionSchema, gridViewOptionSchema, formViewOptionSchema } from './derivate';

export const viewOptionRoSchema = z.union([
  gridViewOptionSchema,
  kanbanViewOptionSchema,
  formViewOptionSchema,
]);

export type IViewOptionRo = z.infer<typeof viewOptionRoSchema>;

export const validateOptionType = (type: ViewType, optionString: IViewOptionRo) => {
  switch (type) {
    case ViewType.Grid:
      gridViewOptionSchema.parse(optionString);
      break;
    case ViewType.Kanban:
      kanbanViewOptionSchema.parse(optionString);
      break;
    case ViewType.Form:
      formViewOptionSchema.parse(optionString);
      break;
    default:
      throw new Error(`Unsupported view type: ${type}`);
  }
};
