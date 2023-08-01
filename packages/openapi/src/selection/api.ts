import type { IJsonApiResponse } from '@teable-group/core';
import axios from '../axios';
import { urlBuilder } from '../utils';
import { CLEAR_URL, COPY_URL, PASTE_URL } from './path';
import type { ClearRo, CopyRo, CopyVo, PasteRo } from './schema';

export const copy = async (tableId: string, viewId: string, copyRo: CopyRo) => {
  return axios.get<IJsonApiResponse<CopyVo>>(
    urlBuilder(COPY_URL, {
      params: { tableId, viewId },
      query: copyRo,
    })
  );
};

export const paste = async (tableId: string, viewId: string, pasteRo: PasteRo) => {
  return axios.post<IJsonApiResponse<null>>(
    urlBuilder(PASTE_URL, {
      params: { tableId, viewId },
    }),
    pasteRo
  );
};

export const clear = async (tableId: string, viewId: string, clearRo: ClearRo) => {
  return axios.post<IJsonApiResponse<null>>(
    urlBuilder(CLEAR_URL, {
      params: { tableId, viewId },
    }),
    clearRo
  );
};
