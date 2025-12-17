import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const RECORD_GET_COLLABORATORS = '/table/{tableId}/record/collaborators';

export const recordGetCollaboratorsRoSchema = z.object({
  fieldId: z.string(),
  skip: z.coerce.number().optional(),
  take: z.coerce.number().optional(),
  search: z.string().optional(),
});

export type IRecordGetCollaboratorsRo = z.infer<typeof recordGetCollaboratorsRoSchema>;

export const recordGetCollaboratorsVoSchema = z.array(
  z.object({
    userId: z.string(),
    userName: z.string(),
    email: z.string(),
    avatar: z.string().nullable().optional(),
  })
);

export type IRecordGetCollaboratorsVo = z.infer<typeof recordGetCollaboratorsVoSchema>;

export const RecordGetCollaboratorsRoute = registerRoute({
  method: 'get',
  path: RECORD_GET_COLLABORATORS,
  description: 'Get collaborators of a record.',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
    query: recordGetCollaboratorsRoSchema,
  },
  responses: {
    200: {
      description: 'Success',
      content: {
        'application/json': {
          schema: recordGetCollaboratorsVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const getRecordGetCollaborators = async (
  tableId: string,
  query: IRecordGetCollaboratorsRo
) => {
  return axios.get<IRecordGetCollaboratorsVo>(urlBuilder(RECORD_GET_COLLABORATORS, { tableId }), {
    params: query,
  });
};
