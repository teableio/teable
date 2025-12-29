import { useMutation, useQuery } from '@tanstack/react-query';
import { FieldType } from '@teable/core';
import { Code2, Copy, Check, Loader2, MagicAi, Key } from '@teable/icons';
import {
  createAccessToken,
  getFields,
  getTableById,
  type CreateAccessTokenVo,
} from '@teable/openapi';
import { MarkdownPreview } from '@teable/sdk';
import { useBaseId, useTableId } from '@teable/sdk/hooks';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ScrollArea,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

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

const TOKEN_PLACEHOLDER = '<YOUR_API_TOKEN>';

const generateAIContext = (
  tableName: string,
  tableDescription: string | undefined,
  fields: IFieldInfo[],
  baseUrl: string,
  tableId: string,
  token?: string
): string => {
  const displayToken = token || TOKEN_PLACEHOLDER;
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
## API Operations

### 1. Read Records (GET)
\`\`\`bash
curl -X GET "${baseUrl}/api/table/${tableId}/record?fieldKeyType=name" \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

#### Pagination
Use \`skip\` and \`take\` parameters:
- \`take\`: Number of records to return (default: 100, max: 1000)
- \`skip\`: Number of records to skip

\`\`\`bash
# Get 20 records, starting from the 41st record (page 3)
curl "${baseUrl}/api/table/${tableId}/record?take=20&skip=40&fieldKeyType=name" \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

#### Filtering
Use the \`filter\` parameter with a JSON object.

**⚠️ Important: The \`fieldId\` in filter/orderBy MUST use the actual field ID (e.g., "fldXXXX"), not the field name.**

\`\`\`bash
# Filter records - use field ID from the Fields section above
curl "${baseUrl}/api/table/${tableId}/record?fieldKeyType=name" \\
  --data-urlencode 'filter={"conjunction":"and","filterSet":[{"fieldId":"fldXXXXXXX","operator":"is","value":"Active"}]}' \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

**Filter Operators**:
- Text: \`is\`, \`isNot\`, \`contains\`, \`doesNotContain\`, \`isEmpty\`, \`isNotEmpty\`
- Number: \`is\`, \`isNot\`, \`isGreater\`, \`isLess\`, \`isGreaterEqual\`, \`isLessEqual\`
- Date: \`is\`, \`isBefore\`, \`isAfter\`, \`isWithin\`

#### Sorting
Use the \`orderBy\` parameter.

**⚠️ Important: The \`fieldId\` in orderBy MUST use the actual field ID (e.g., "fldXXXX"), not the field name.**

\`\`\`bash
# Sort by a field - use field ID from the Fields section above
curl "${baseUrl}/api/table/${tableId}/record?fieldKeyType=name" \\
  --data-urlencode 'orderBy=[{"fieldId":"fldXXXXXXX","order":"desc"}]' \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

#### Field Selection (Projection)
Use the \`projection\` parameter to return only specific fields:
\`\`\`bash
# Only return "Name" and "Email" fields
curl "${baseUrl}/api/table/${tableId}/record?fieldKeyType=name&projection=Name&projection=Email" \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

#### Searching
Use the \`search\` parameter:
\`\`\`bash
# Search for "john" in all fields
curl "${baseUrl}/api/table/${tableId}/record?search=john&fieldKeyType=name" \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

### 2. Create Record (POST)
\`\`\`bash
curl -X POST "${baseUrl}/api/table/${tableId}/record" \\
  -H "Authorization: Bearer ${displayToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fieldKeyType": "name",
    "records": [
      {
        "fields": {
          // Editable fields: ${editableFields || 'None'}
        }
      }
    ]
  }'
\`\`\`

### 3. Update Record (PATCH)
\`\`\`bash
curl -X PATCH "${baseUrl}/api/table/${tableId}/record/{recordId}" \\
  -H "Authorization: Bearer ${displayToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fieldKeyType": "name",
    "record": {
      "fields": {
        // Include only fields you want to update
      }
    }
  }'
\`\`\`

### 4. Delete Record (DELETE)
\`\`\`bash
curl -X DELETE "${baseUrl}/api/table/${tableId}/record/{recordId}" \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

---

## API Configuration
- **Base URL**: ${baseUrl}
- **Table ID**: ${tableId}
- **API Token**: ${displayToken}
- **Endpoint**: \`${baseUrl}/api/table/${tableId}/record\`

## Authentication
All requests require the \`Authorization\` header:
\`\`\`
Authorization: Bearer ${displayToken}
\`\`\`

---

## Fields
${fieldDescriptions}

---

## Notes for AI
- Fields marked [PRIMARY] are the main identifier field
- Fields marked [READ-ONLY] are computed and cannot be directly modified
- Use \`fieldKeyType=name\` to reference fields by their display name in request/response body
- **Important**: \`filter\` and \`orderBy\` parameters MUST use field IDs (the [id: fldXXX] shown above), not field names
- Dates should be in ISO 8601 format (e.g., "2024-01-15T10:30:00Z")
- For select fields, use the exact option names listed above
- For link fields, provide an array of record IDs from the linked table
- Response format: \`{ "records": [...], "offset": "..." }\` for pagination
`;
};

interface APIDialogProps {
  children: React.ReactNode;
}

export const APIDialog = ({ children }: APIDialogProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const baseId = useBaseId() as string;
  const tableId = useTableId() as string;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [generatedToken, setGeneratedToken] = useState<CreateAccessTokenVo | null>(null);
  const [showTokenConfirm, setShowTokenConfirm] = useState(false);

  useEffect(() => {
    setCurrentUrl(window.location.origin);
  }, []);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setGeneratedToken(null);
    }
  }, [open]);

  // Fetch table info
  const { data: tableInfo } = useQuery({
    queryKey: ['table-info-api-dialog', baseId, tableId],
    queryFn: () => getTableById(baseId, tableId).then((res) => res.data),
    enabled: Boolean(tableId) && Boolean(baseId) && open,
  });

  // Fetch fields
  const { data: fieldsData } = useQuery({
    queryKey: ['fields-api-dialog', tableId],
    queryFn: () => getFields(tableId).then((res) => res.data),
    enabled: Boolean(tableId) && open,
  });

  // Create token mutation
  const createTokenMutation = useMutation({
    mutationFn: async () => {
      const expiredTime = new Date();
      expiredTime.setFullYear(expiredTime.getFullYear() + 1);

      return createAccessToken({
        name: `API Token for ${tableInfo?.name || 'Table'} (Auto-generated)`,
        description: `Auto-generated token for AI integration. Base: ${baseId}, Table: ${tableId}`,
        scopes: [
          'table|read',
          'field|read',
          'record|read',
          'record|create',
          'record|update',
          'record|delete',
        ],
        baseIds: [baseId],
        expiredTime: expiredTime.toISOString(),
      });
    },
    onSuccess: (res) => {
      setGeneratedToken(res.data);
    },
  });

  const handleConfirmCreateToken = useCallback(() => {
    setShowTokenConfirm(false);
    createTokenMutation.mutate();
  }, [createTokenMutation]);

  const fields: IFieldInfo[] = useMemo(() => {
    if (!fieldsData) return [];
    return fieldsData.map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      description: field.description,
      options: field.options,
      isPrimary: field.isPrimary,
      isComputed: field.isComputed,
    }));
  }, [fieldsData]);

  const aiContext = useMemo(() => {
    if (!tableInfo) return '';
    return generateAIContext(
      tableInfo.name,
      tableInfo.description,
      fields,
      currentUrl,
      tableId,
      generatedToken?.token
    );
  }, [tableInfo, fields, currentUrl, tableId, generatedToken]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(aiContext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [aiContext]);

  const isLoading = createTokenMutation.isLoading;
  const isDataLoading = !tableInfo || !fieldsData;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code2 className="size-5" />
            {t('table:toolbar.others.api.title')}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="ai-context" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="ai-context" className="gap-2">
              <MagicAi className="size-4" />
              {t('table:toolbar.others.api.aiContext')}
            </TabsTrigger>
            <TabsTrigger value="advanced" className="gap-2">
              <Code2 className="size-4" />
              {t('table:toolbar.others.api.advanced')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ai-context" className="w-full overflow-hidden">
            {isDataLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">{t('common:actions.loading')}</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <h3 className="mb-2 font-medium">
                    {t('table:toolbar.others.api.aiContextTitle')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {generatedToken
                      ? t('table:toolbar.others.api.aiContextDescriptionWithToken')
                      : t('table:toolbar.others.api.aiContextDescriptionNoToken')}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4">
                  {generatedToken ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                        <Check className="size-4" />
                        {t('table:toolbar.others.api.tokenCreatedSuccess')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('table:toolbar.others.api.tokenInfo', {
                          expiry: new Date(generatedToken.expiredTime).toLocaleDateString(),
                        })}
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setShowTokenConfirm(true)}
                      disabled={isLoading}
                      className="gap-2"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          {t('table:toolbar.others.api.generatingToken')}
                        </>
                      ) : (
                        <>
                          <Key className="size-4" />
                          {t('table:toolbar.others.api.generateToken')}
                        </>
                      )}
                    </Button>
                  )}
                  <Button onClick={handleCopy} className="gap-2">
                    {copied ? (
                      <>
                        <Check className="size-4" />
                        {t('table:toolbar.others.api.copied')}
                      </>
                    ) : (
                      <>
                        <Copy className="size-4" />
                        {t('table:toolbar.others.api.copy')}
                      </>
                    )}
                  </Button>
                </div>

                <ScrollArea className="h-[400px] rounded-lg border bg-muted/20 p-4">
                  <MarkdownPreview>{aiContext}</MarkdownPreview>
                </ScrollArea>
              </div>
            )}

            {/* Token Creation Confirmation Dialog */}
            <AlertDialog open={showTokenConfirm} onOpenChange={setShowTokenConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('table:toolbar.others.api.confirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-3">
                    <p>{t('table:toolbar.others.api.confirmDescription')}</p>
                    <ul className="list-inside list-disc space-y-1">
                      <li>{t('table:toolbar.others.api.scopeTableRead')}</li>
                      <li>{t('table:toolbar.others.api.scopeFieldRead')}</li>
                      <li>{t('table:toolbar.others.api.scopeRead')}</li>
                      <li>{t('table:toolbar.others.api.scopeCreate')}</li>
                      <li>{t('table:toolbar.others.api.scopeUpdate')}</li>
                      <li>{t('table:toolbar.others.api.scopeDelete')}</li>
                    </ul>
                    <p>{t('table:toolbar.others.api.confirmExpiry')}</p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleConfirmCreateToken}>
                    {t('table:toolbar.others.api.confirmButton')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          <TabsContent value="advanced">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('table:toolbar.others.api.advancedDesc')}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  const path = `/developer/tool/query-builder`;
                  const url = new URL(path, window.location.origin);
                  url.searchParams.set('baseId', baseId);
                  url.searchParams.set('tableId', tableId);
                  window.open(url.toString(), '_blank');
                }}
              >
                {t('table:toolbar.others.api.openAdvanced')}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
