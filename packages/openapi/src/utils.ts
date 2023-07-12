export const urlBuilder = (
  url: string,
  opt?: {
    query?: Record<string, unknown>;
    params?: Record<string, unknown>;
  }
) => {
  const { query = {}, params = {} } = opt || {};
  Object.entries(params).forEach(([key, value]) => {
    url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
  });

  const queryString = Object.entries(query)
    .map(([key, value]) => {
      return `${key}=${value}`;
    })
    .join('&');

  return `${url}?${queryString}`;
};
