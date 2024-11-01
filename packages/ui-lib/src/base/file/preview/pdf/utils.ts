import { getBlobFromUrl } from '../office/utils';

export const getBlobUrlFromUrl = async (url: string) => {
  const blob = await getBlobFromUrl(url);
  return URL.createObjectURL(blob);
};
