export function addQueryParamsToWebSocketUrl(url: string, params: Record<string, string>) {
  const urlObj = new URL(url);

  Object.keys(params).forEach((key) => {
    urlObj.searchParams.set(key, params[key]);
  });

  return urlObj.toString();
}
