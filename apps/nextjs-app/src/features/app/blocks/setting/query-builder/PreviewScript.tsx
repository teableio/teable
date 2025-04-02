import type { IGetRecordsRo } from '@teable/openapi';
import { Button, cn, Input, ToggleGroup, ToggleGroupItem } from '@teable/ui-lib/shadcn';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import React, { useState, useMemo, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { CopyButton } from '@/features/app/components/CopyButton';
import { developerConfig } from '@/features/i18n/developer.config';
import { useTransformFieldKey } from './useTransformFieldKey';

export const CodeBlock = ({
  code,
  className,
  language,
}: {
  code: string;
  className?: string;
  language?: string;
}) => (
  <div className={cn('relative', className)}>
    <CopyButton text={code} className="absolute right-4 top-4" />
    <SyntaxHighlighter
      language={language}
      style={vscDarkPlus}
      customStyle={{
        margin: 0,
        borderRadius: '0.5rem',
        padding: '1rem',
        wordBreak: 'break-all',
      }}
      codeTagProps={{ style: { wordBreak: 'break-all' } }}
      wrapLines
      wrapLongLines
    >
      {code}
    </SyntaxHighlighter>
  </div>
);

const LanguageSelector = ({
  selectedLanguage,
  onLanguageChange,
}: {
  selectedLanguage: string;
  onLanguageChange: (language: string) => void;
}) => (
  <ToggleGroup
    className="w-auto"
    type="single"
    variant="outline"
    size="sm"
    value={selectedLanguage}
    onValueChange={(v) => onLanguageChange(v || 'curl')}
  >
    <ToggleGroupItem value="curl" aria-label="Toggle curl">
      cURL
    </ToggleGroupItem>
    <ToggleGroupItem value="javascript" aria-label="Toggle javascript">
      JavaScript
    </ToggleGroupItem>
    <ToggleGroupItem value="python" aria-label="Toggle python">
      Python
    </ToggleGroupItem>
  </ToggleGroup>
);

const generateCurlCode = (endpoint: string, params: Record<string, unknown>, token: string) => {
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

const generateJavaScriptCode = (
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

const generatePythonCode = (endpoint: string, params: Record<string, unknown>, token: string) => {
  const paramEntries = Object.entries(params).filter(([_, value]) => value != null);

  const paramStrings = paramEntries.map(([key, value]) => {
    if (key === 'filter' || key === 'orderBy') {
      return `    "${key}": json.dumps(${JSON.stringify(value)})`;
    }
    return `    "${key}": ${JSON.stringify(value)}`;
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

interface QueryParamsTableProps {
  query: IGetRecordsRo;
}

export const QueryParamsTable: React.FC<QueryParamsTableProps> = ({ query }) => {
  const renderValue = (key: string, value: unknown): string => {
    if (key === 'filter' || key === 'orderBy') {
      return value ? JSON.stringify(value) : '';
    }
    return String(value);
  };

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="w-60 border p-2 text-left">Key</th>
          <th className="border p-2 text-left">Value</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(query)
          .filter(([_, value]) => value != null)
          .map(([key, value]) => (
            <tr key={key}>
              <td className="border p-2">{key}</td>
              <td className="text-wrap break-all border p-2 font-mono text-sm">
                {renderValue(key, value)}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
};

export const PreviewScript = ({
  tableId,
  query: queryRaw,
}: {
  tableId: string;
  token?: string;
  query: IGetRecordsRo;
}) => {
  const { t } = useTranslation(developerConfig.i18nNamespaces);
  const [currentUrl, setCurrentUrl] = useState('');
  const query = useTransformFieldKey()(queryRaw);

  useEffect(() => {
    if (process) {
      setCurrentUrl(window.location.origin);
    }
  }, []);

  const [selectedLanguage, setSelectedLanguage] = useState<'curl' | 'javascript' | 'python'>(
    'curl'
  );

  const [token, setToken] = useState<string>('_YOUR_API_TOKEN_');

  const endpoint = `${currentUrl}/api/table/${tableId}/record`;

  const codeExamples = useMemo(
    () => ({
      curl: { code: generateCurlCode(endpoint, query, token), language: 'bash' },
      javascript: { code: generateJavaScriptCode(endpoint, query, token), language: 'javascript' },
      python: { code: generatePythonCode(endpoint, query, token), language: 'python' },
    }),
    [endpoint, query, token]
  );

  return (
    <div className="w-full space-y-4">
      <QueryParamsTable query={query} />
      <div className="flex items-center gap-4">
        <LanguageSelector
          selectedLanguage={selectedLanguage}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onLanguageChange={(language) => setSelectedLanguage(language as any)}
        />
        {t('developer:replaceToken')}:
        <Input
          className="w-80"
          type="text"
          value={token}
          onChange={(v) => setToken(v.target.value)}
        />
        <Button variant="link" asChild>
          <Link href="/setting/personal-access-token" target="_blank">
            <ArrowUpRight className="size-4" />
            {t('developer:createNewToken')}
          </Link>
        </Button>
      </div>

      <CodeBlock
        className="overflow-hidden text-wrap break-all rounded-lg border text-sm"
        code={codeExamples[selectedLanguage].code}
        language={codeExamples[selectedLanguage].language}
      />
    </div>
  );
};
