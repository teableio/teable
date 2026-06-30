export const generateCurlCode = (
  endpoint: string,
  params: Record<string, unknown>,
  token: string
) => {
  const queryParams = new URLSearchParams();
  Object.entries(params)
    .filter(([_, value]) => value != null)
    .forEach(([key, value]) => {
      if (key === 'filter' || key === 'orderBy') {
        queryParams.append(key, JSON.stringify(value));
      } else if (Array.isArray(value)) {
        value.forEach((item) => queryParams.append(key, item.toString()));
      } else {
        queryParams.append(key, value as string);
      }
    });
  const queryString = queryParams.toString();
  const url = `${endpoint}${queryString ? `?${queryString}` : ''}`;
  return `curl -X GET \\
  "${url}" \\
  -H "Authorization: Bearer ${token || 'YOUR_API_TOKEN'}" \\
  -H "Accept: application/json"`;
};

export const generateJavaScriptCode = (
  endpoint: string,
  params: Record<string, unknown>,
  token: string
) => {
  const paramEntries = Object.entries(params).filter(([_, value]) => value != null);

  const paramStrings = paramEntries.map(([key, value]) => {
    if (key === 'filter' || key === 'orderBy') {
      return `  ${key}: JSON.stringify(${JSON.stringify(value)})`;
    }
    return `  ${key}: ${JSON.stringify(value)}`;
  });

  const paramsCode =
    paramStrings.length > 0
      ? `const params = {
${paramStrings.join(',\n')}
};`
      : '';

  const urlParamsCode =
    paramStrings.length > 0
      ? `
Object.entries(params).forEach(([key, value]) => {
  url.searchParams.append(key, value);
});`
      : '';

  return `
const url = new URL("${endpoint}");
${paramsCode}
${urlParamsCode}

fetch(url, {
  method: "GET",
  headers: {
    "Authorization": "Bearer ${token || 'YOUR_API_TOKEN'}",
    "Accept": "application/json"
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
`.slice(1);
};

// JSON-decoded value -> Python literal source (e.g. null -> None, true -> True)
export const toPythonLiteral = (value: unknown): string => {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `'${escaped}'`;
  }
  if (Array.isArray(value)) return `[${value.map(toPythonLiteral).join(', ')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${toPythonLiteral(k)}: ${toPythonLiteral(v)}`)
    .join(', ')}}`;
};

export const generatePythonCode = (
  endpoint: string,
  params: Record<string, unknown>,
  token: string
) => {
  const paramEntries = Object.entries(params).filter(([_, value]) => value != null);

  const paramStrings = paramEntries.map(([key, value]) => {
    if (key === 'filter' || key === 'orderBy') {
      return `    "${key}": json.dumps(${toPythonLiteral(value)})`;
    }
    return `    "${key}": ${toPythonLiteral(value)}`;
  });

  const paramsCode =
    paramStrings.length > 0
      ? `params = {
${paramStrings.join(',\n')}
}`
      : '';

  return `
import requests
import json

url = "${endpoint}"
${paramsCode}

headers = {
    "Authorization": "Bearer ${token || 'YOUR_API_TOKEN'}",
    "Accept": "application/json"
}

response = requests.get(url${paramsCode ? ', params=params' : ''}, headers=headers)
print(response.json())
`.slice(1);
};
