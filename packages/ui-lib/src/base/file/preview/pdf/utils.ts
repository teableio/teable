import { getBlobFromUrl } from '../office/utils';
import { toPdfBlob } from '../utils';

export const getBlobUrlFromUrl = async (url: string) => {
  const blob = await getBlobFromUrl(url);
  return URL.createObjectURL(toPdfBlob(blob));
};
