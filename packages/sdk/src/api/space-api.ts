import type { SpaceSchema } from '@teable-group/openapi';
import { SpacePath } from '@teable-group/openapi';
import { axios } from '../config';
import { urlBuilder } from './utils';

export const getSpaceById = async (spaceId: string) => {
  return await axios.get<SpaceSchema.IGetSpaceVo>(
    urlBuilder(SpacePath.GET_SPACE, {
      params: {
        spaceId,
      },
    })
  );
};

export const createSpace = async (createSpaceRo: SpaceSchema.ICreateSpaceRo) => {
  return await axios.post<SpaceSchema.ICreateSpaceVo>(SpacePath.CREATE_SPACE, createSpaceRo);
};

export const deleteSpace = async (spaceId: string) => {
  return await axios.delete<null>(
    urlBuilder(SpacePath.DELETE_SPACE, {
      params: {
        spaceId,
      },
    })
  );
};

export const getSpaceList = async () => {
  return await axios.get<SpaceSchema.IGetSpaceVo[]>(SpacePath.GET_SPACE_LIST);
};

export const updateSpace = async (params: {
  spaceId: string;
  updateSpaceRo: SpaceSchema.IUpdateSpaceRo;
}) => {
  const { spaceId, updateSpaceRo } = params;
  return await axios.patch<SpaceSchema.IUpdateSpaceVo>(
    urlBuilder(SpacePath.UPDATE_SPACE, {
      params: {
        spaceId,
      },
    }),
    updateSpaceRo
  );
};
