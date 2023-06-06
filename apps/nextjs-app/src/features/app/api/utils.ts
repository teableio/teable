export const urlParams = (url: string, params: { [key: string]: unknown }) => {
  for (const [k, v] of Object.entries(params)) {
    url = url.replace(`{${k}}`, encodeURIComponent(String(v)));
  }
  return url;
};
