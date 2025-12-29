import { useQuery } from '@tanstack/react-query';
import { FieldType } from '@teable/core';
import { Copy, Check } from '@teable/icons';
import { getFields, getTableById } from '@teable/openapi';
import { Button, Skeleton, Tabs, TabsList, TabsTrigger, TabsContent } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState, useMemo, useEffect } from 'react';
import { developerConfig } from '@/features/i18n/developer.config';
import { CodeBlock } from './PreviewScript';

interface IAIContextPanelProps {
  tableId: string;
  baseId: string;
}

interface IFieldInfo {
  id: string;
  name: string;
  type: string;
  description?: string;
  options?: unknown;
  isPrimary?: boolean;
  isComputed?: boolean;
}

const getFieldTypeDescription = (type: FieldType, options?: unknown): string => {
  switch (type) {
    case FieldType.SingleLineText:
      return 'Single line text';
    case FieldType.LongText:
      return 'Long text / Rich text';
    case FieldType.Number:
      return 'Number';
    case FieldType.SingleSelect: {
      const opts = options as { choices?: { name: string }[] };
      const choices = opts?.choices?.map((c) => c.name).join(', ') || '';
      return choices ? `Single select (options: ${choices})` : 'Single select';
    }
    case FieldType.MultipleSelect: {
      const opts = options as { choices?: { name: string }[] };
      const choices = opts?.choices?.map((c) => c.name).join(', ') || '';
      return choices ? `Multiple select (options: ${choices})` : 'Multiple select';
    }
    case FieldType.Checkbox:
      return 'Checkbox (true/false)';
    case FieldType.Date:
      return 'Date/Time';
    case FieldType.Attachment:
      return 'File attachments';
    case FieldType.Link:
      return 'Link to another table';
    case FieldType.Formula:
      return 'Computed formula field';
    case FieldType.Rollup:
    case FieldType.ConditionalRollup:
      return 'Rollup (aggregation from linked records)';
    case FieldType.User:
      return 'User reference';
    case FieldType.CreatedTime:
      return 'Created time (auto-generated)';
    case FieldType.LastModifiedTime:
      return 'Last modified time (auto-generated)';
    case FieldType.CreatedBy:
      return 'Created by (auto-generated)';
    case FieldType.LastModifiedBy:
      return 'Last modified by (auto-generated)';
    case FieldType.AutoNumber:
      return 'Auto-incrementing number';
    case FieldType.Rating:
      return 'Rating (1-5 stars)';
    case FieldType.Button:
      return 'Button (trigger actions)';
    default:
      return type;
  }
};

const generateAIContext = (
  tableName: string,
  tableDescription: string | undefined,
  fields: IFieldInfo[],
  baseUrl: string,
  tableId: string
): string => {
  const fieldDescriptions = fields
    .map((field) => {
      const typeDesc = getFieldTypeDescription(field.type as FieldType, field.options);
      const primary = field.isPrimary ? ' [PRIMARY]' : '';
      const computed = field.isComputed ? ' [READ-ONLY]' : '';
      const desc = field.description ? ` - ${field.description}` : '';
      return `  - "${field.name}" [id: ${field.id}] (${typeDesc})${primary}${computed}${desc}`;
    })
    .join('\n');

  const editableFields = fields
    .filter((f) => !f.isComputed)
    .map((f) => `"${f.name}"`)
    .join(', ');

  return `# Table: ${tableName}
${tableDescription ? `\nDescription: ${tableDescription}\n` : ''}
## Fields
${fieldDescriptions}

## API Information
- Base URL: ${baseUrl}
- Table ID: ${tableId}
- API Endpoint: ${baseUrl}/api/table/${tableId}/record

## How to Interact with This Table

### Read Records (GET)
\`\`\`
GET ${baseUrl}/api/table/${tableId}/record?fieldKeyType=name
Authorization: Bearer YOUR_API_TOKEN
\`\`\`

Query Parameters:
- filter: JSON filter object for filtering records (⚠️ use field ID, not name)
- orderBy: JSON array for sorting (⚠️ use field ID, not name)
- search: Search text across all fields
- take: Number of records to return (default: 100, max: 1000)
- skip: Number of records to skip for pagination

**Important**: The \`fieldId\` in filter/orderBy MUST use the actual field ID (e.g., "fldXXXX"), not the field name. Field IDs are listed above in the Fields section.

### Create Record (POST)
\`\`\`
POST ${baseUrl}/api/table/${tableId}/record
Authorization: Bearer YOUR_API_TOKEN
Content-Type: application/json

{
  "fieldKeyType": "name",
  "records": [
    {
      "fields": {
        // Editable fields: ${editableFields || 'None'}
      }
    }
  ]
}
\`\`\`

### Update Record (PATCH)
\`\`\`
PATCH ${baseUrl}/api/table/${tableId}/record/{recordId}
Authorization: Bearer YOUR_API_TOKEN
Content-Type: application/json

{
  "fieldKeyType": "name",
  "record": {
    "fields": {
      // Include only fields you want to update
    }
  }
}
\`\`\`

### Delete Record (DELETE)
\`\`\`
DELETE ${baseUrl}/api/table/${tableId}/record/{recordId}
Authorization: Bearer YOUR_API_TOKEN
\`\`\`

## Notes for AI
- Fields marked [PRIMARY] are the main identifier field
- Fields marked [READ-ONLY] are computed and cannot be directly modified
- Use fieldKeyType=name to reference fields by their display name in request/response body
- **Important**: filter and orderBy parameters MUST use field IDs (e.g., "fldXXXX"), not field names
- Dates should be in ISO 8601 format
- For select fields, use the exact option names listed
- For link fields, provide an array of record IDs from the linked table
`;
};

const generateCompactAIContext = (
  tableName: string,
  tableDescription: string | undefined,
  fields: IFieldInfo[],
  baseUrl: string,
  tableId: string
): string => {
  const fieldList = fields
    .map((f) => {
      const typeDesc = getFieldTypeDescription(f.type as FieldType, f.options);
      const flags = [f.isPrimary && 'PRIMARY', f.isComputed && 'READ-ONLY']
        .filter(Boolean)
        .join(',');
      return `${f.name} (${typeDesc})${flags ? ` [${flags}]` : ''}`;
    })
    .join('; ');

  return `Table "${tableName}"${tableDescription ? ` - ${tableDescription}` : ''}
Fields: ${fieldList}
API: ${baseUrl}/api/table/${tableId}/record (GET/POST/PATCH/DELETE)
Auth: Bearer token required. Use fieldKeyType=name for field references.`;
};

export const AIContextPanel = ({ tableId, baseId }: IAIContextPanelProps) => {
  const { t } = useTranslation(developerConfig.i18nNamespaces);
  const [copied, setCopied] = useState<'full' | 'compact' | null>(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [contextFormat, setContextFormat] = useState<'full' | 'compact'>('full');

  useEffect(() => {
    setCurrentUrl(window.location.origin);
  }, []);

  const { data: tableInfo, isLoading: isTableLoading } = useQuery({
    queryKey: ['table-info-ai', baseId, tableId],
    queryFn: () => getTableById(baseId, tableId).then((res) => res.data),
    enabled: Boolean(tableId) && Boolean(baseId),
  });

  const { data: fieldsData, isLoading: isFieldsLoading } = useQuery({
    queryKey: ['fields-ai', tableId],
    queryFn: () => getFields(tableId).then((res) => res.data),
    enabled: Boolean(tableId),
  });

  const isLoading = isTableLoading || isFieldsLoading;

  const { fullContext, compactContext } = useMemo(() => {
    if (!tableInfo || !fieldsData) {
      return { fullContext: '', compactContext: '' };
    }

    const fields: IFieldInfo[] = fieldsData.map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      description: field.description,
      options: field.options,
      isPrimary: field.isPrimary,
      isComputed: field.isComputed,
    }));

    return {
      fullContext: generateAIContext(
        tableInfo.name,
        tableInfo.description,
        fields,
        currentUrl,
        tableId
      ),
      compactContext: generateCompactAIContext(
        tableInfo.name,
        tableInfo.description,
        fields,
        currentUrl,
        tableId
      ),
    };
  }, [tableInfo, fieldsData, currentUrl, tableId]);

  const handleCopy = async (type: 'full' | 'compact') => {
    const text = type === 'full' ? fullContext : compactContext;
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!tableId) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        {t('developer:aiContext.selectTableFirst')}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <h3 className="mb-2 font-medium">{t('developer:aiContext.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('developer:aiContext.description')}</p>
      </div>

      <Tabs value={contextFormat} onValueChange={(v) => setContextFormat(v as 'full' | 'compact')}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="full">{t('developer:aiContext.fullContext')}</TabsTrigger>
            <TabsTrigger value="compact">{t('developer:aiContext.compactContext')}</TabsTrigger>
          </TabsList>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleCopy(contextFormat)}
            className="gap-2"
          >
            {copied === contextFormat ? (
              <>
                <Check className="size-4" />
                {t('developer:aiContext.copied')}
              </>
            ) : (
              <>
                <Copy className="size-4" />
                {t('developer:aiContext.copyToClipboard')}
              </>
            )}
          </Button>
        </div>

        <TabsContent value="full" className="mt-4">
          <CodeBlock
            code={fullContext}
            language="markdown"
            className="max-h-[600px] overflow-auto"
          />
        </TabsContent>

        <TabsContent value="compact" className="mt-4">
          <div className="rounded-lg border bg-muted/50 p-4">
            <pre className="whitespace-pre-wrap text-sm">{compactContext}</pre>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('developer:aiContext.compactDescription')}
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
};
