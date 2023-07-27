import type { IJsonApiResponse } from '@teable-group/core';
import axios from '../axios';
import { urlBuilder } from '../utils';
import { COPY_URL, PASTE_URL } from './path';
import type { CopyRo, CopyVo, PasteRo } from './schema';

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
