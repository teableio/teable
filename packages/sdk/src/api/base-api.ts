import type { BaseSchema } from '@teable-group/openapi';
import { BasePath } from '@teable-group/openapi';
import { axios } from '../config';
import { urlBuilder } from './utils';

export const getBaseById = async (baseId: string) => {
  return await axios.get<BaseSchema.IGetBaseVo>(
    urlBuilder(BasePath.GET_BASE, {
      params: {
        baseId,
      },
    })
  );
};

export const createBase = async (createBaseRo: BaseSchema.ICreateBaseRo) => {
  return await axios.post<BaseSchema.ICreateBaseVo>(BasePath.CREATE_BASE, createBaseRo);
};

export const deleteBase = async (baseId: string) => {
  return await axios.delete<null>(
    urlBuilder(BasePath.DELETE_BASE, {
      params: {
        baseId,
      },
    })
  );
};

export const getBaseList = async (query?: BaseSchema.IGetBasesListRo) => {
  return await axios.get<BaseSchema.IGetBaseVo[]>(
    urlBuilder(BasePath.GET_BASE_LIST, {
      query,
    })
  );
};

export const updateBase = async (params: {
  baseId: string;
  updateBaseRo: BaseSchema.IUpdateBaseRo;
}) => {
  const { baseId, updateBaseRo } = params;
  return await axios.patch<BaseSchema.IUpdateBaseVo>(
    urlBuilder(BasePath.UPDATE_BASE, {
      params: {
        baseId,
      },
    }),
    updateBaseRo
  );
};
