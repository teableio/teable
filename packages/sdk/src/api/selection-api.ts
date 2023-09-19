import type { SelectionSchema } from '@teable-group/openapi';
import { SelectionPath } from '@teable-group/openapi';
import { axios } from '../config/axios';
import { urlBuilder } from './utils';

// eslint-disable-next-line @typescript-eslint/naming-convention
const { CLEAR_URL, COPY_URL, PASTE_URL } = SelectionPath;

export const copy = async (tableId: string, viewId: string, copyRo: SelectionSchema.CopyRo) => {
  return axios.get<SelectionSchema.CopyVo>(
    urlBuilder(COPY_URL, {
      params: { tableId, viewId },
      query: copyRo,
    })
  );
};

export const paste = async (tableId: string, viewId: string, pasteRo: SelectionSchema.PasteRo) => {
  return axios.post<null>(
    urlBuilder(PASTE_URL, {
      params: { tableId, viewId },
    }),
    pasteRo
  );
};

export const clear = async (tableId: string, viewId: string, clearRo: SelectionSchema.ClearRo) => {
  return axios.post<null>(
    urlBuilder(CLEAR_URL, {
      params: { tableId, viewId },
    }),
    clearRo
  );
};
