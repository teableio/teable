import { useState, useCallback, useMemo } from 'react';
import {
  Link2,
  X,
  Plus,
  Search,
  ExternalLink,
  AlertCircle,
  SquareArrowOutUpRight,
} from 'lucide-react';
import type { LinkField } from '@teable/v2-core';
import type { ITableRecordDto } from '@teable/v2-contract-http';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { FieldInputProps } from './types';

interface LinkedRecord {
  id: string;
  title: string;
}

export function LinkFieldInput({
  field,
  value,
  onChange,
  disabled,
  orpcClient,
  baseId,
}: FieldInputProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [records, setRecords] = useState<LinkedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkField = field as LinkField;
  const fieldName = field.name().toString();
  const isRequired = field.notNull().toBoolean();

  // Parse value - could be single record or array of records
  const selectedRecords: LinkedRecord[] = Array.isArray(value)
    ? value.map((v) =>
        typeof v === 'object' && v !== null
          ? (v as LinkedRecord)
          : { id: String(v), title: String(v) }
      )
    : value && typeof value === 'object'
      ? [value as LinkedRecord]
      : [];

  const foreignTableId = linkField.foreignTableId().toString();
  const lookupFieldId = linkField.lookupFieldId().toString();
  const isMultipleValue = linkField.isMultipleValue();
  // For cross-base links, linkField.baseId() returns the foreign table's base ID
  // For same-base links, it returns undefined, so we use the current baseId
  const foreignBaseId = linkField.baseId()?.toString() ?? baseId;

  // Build the URL to navigate to the foreign table
  const foreignTableUrl = useMemo(() => {
    if (!foreignBaseId) return null;
    // Detect if we're in sandbox mode based on current pathname
    const isSandbox =
      typeof window !== 'undefined' && window.location.pathname.startsWith('/sandbox');
    const prefix = isSandbox ? '/sandbox' : '';
    return `${prefix}/${foreignBaseId}/${foreignTableId}`;
  }, [foreignBaseId, foreignTableId]);

  const handleOpenForeignTable = () => {
    if (foreignTableUrl) {
      window.open(foreignTableUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // Fetch records from the foreign table
  const fetchRecords = useCallback(
    async (_search: string) => {
      if (!orpcClient) {
        setError('ORPC client not available');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await orpcClient.tables.listRecords({
          tableId: foreignTableId,
        });

        if (!response.ok) {
          setError(response.error?.message || 'Failed to fetch records');
          setRecords([]);
          return;
        }

        // Map records to LinkedRecord format
        // Use the lookupFieldId to get the primary field value as title
        const linkedRecords: LinkedRecord[] = response.data.records.map(
          (record: ITableRecordDto) => {
            const primaryValue = record.fields[lookupFieldId];
            const title =
              primaryValue !== null && primaryValue !== undefined
                ? String(primaryValue)
                : record.id;
            return {
              id: record.id,
              title,
            };
          }
        );

        // Filter by search term if provided
        const filteredRecords = _search
          ? linkedRecords.filter(
              (r) =>
                r.title.toLowerCase().includes(_search.toLowerCase()) ||
                r.id.toLowerCase().includes(_search.toLowerCase())
            )
          : linkedRecords;

        setRecords(filteredRecords);
      } catch (err) {
        console.error('Failed to fetch records:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setRecords([]);
      } finally {
        setLoading(false);
      }
    },
    [orpcClient, foreignTableId, lookupFieldId]
  );

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      fetchRecords('');
    } else {
      setSearchTerm('');
      setRecords([]);
      setError(null);
    }
  };

  const handleSearch = (term: string) => {
    setSearchTerm(term);
    fetchRecords(term);
  };

  const handleSelectRecord = (record: LinkedRecord) => {
    if (isMultipleValue) {
      const alreadySelected = selectedRecords.some((r) => r.id === record.id);
      if (alreadySelected) {
        const newRecords = selectedRecords.filter((r) => r.id !== record.id);
        onChange(newRecords.length > 0 ? newRecords : null);
      } else {
        onChange([...selectedRecords, record]);
      }
    } else {
      onChange(record);
      setOpen(false);
    }
  };

  const handleRemoveRecord = (recordId: string) => {
    const newRecords = selectedRecords.filter((r) => r.id !== recordId);
    onChange(newRecords.length > 0 ? newRecords : null);
  };

  const isSelected = (recordId: string) => selectedRecords.some((r) => r.id === recordId);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="flex-1 justify-start font-normal"
              disabled={disabled}
            >
              <Link2 className="mr-2 h-4 w-4" />
              {selectedRecords.length > 0 ? (
                `${selectedRecords.length} record${selectedRecords.length > 1 ? 's' : ''} linked`
              ) : (
                <span className="text-muted-foreground">
                  Link {fieldName.toLowerCase()}
                  {isRequired ? '' : ' (optional)'}
                </span>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                Link Records
              </DialogTitle>
              <DialogDescription asChild>
                <div>
                  <span>Search and select records from the linked table.</span>
                  <span className="mt-1 text-xs flex items-center gap-2">
                    <span>
                      Foreign Table ID:{' '}
                      <code className="bg-muted px-1 rounded">{foreignTableId}</code>
                    </span>
                    {foreignTableUrl && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={handleOpenForeignTable}
                          >
                            <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>在新窗口中打开关联表</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search records..."
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <ScrollArea className="h-[300px] rounded-md border">
                <div className="p-2">
                  {loading ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                      <span className="ml-2">Loading...</span>
                    </div>
                  ) : error ? (
                    <div className="flex flex-col items-center justify-center py-8 text-destructive">
                      <AlertCircle className="h-8 w-8 mb-2" />
                      <span className="text-center">{error}</span>
                    </div>
                  ) : records.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <ExternalLink className="h-8 w-8 mb-2" />
                      <span>No records found</span>
                      {searchTerm && (
                        <span className="text-xs mt-1">Try a different search term</span>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {records.map((record) => (
                        <button
                          key={record.id}
                          type="button"
                          onClick={() => handleSelectRecord(record)}
                          className={`w-full flex items-center justify-between p-2 rounded-md text-left transition-colors ${
                            isSelected(record.id) ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                          }`}
                        >
                          <div className="flex flex-col truncate">
                            <span className="truncate font-medium">{record.title}</span>
                            <span className="text-xs text-muted-foreground truncate">
                              {record.id}
                            </span>
                          </div>
                          {isSelected(record.id) ? (
                            <Badge variant="secondary" className="ml-2 shrink-0">
                              Selected
                            </Badge>
                          ) : (
                            <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </DialogContent>
        </Dialog>
        {foreignTableUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleOpenForeignTable}
              >
                <SquareArrowOutUpRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>在新窗口中打开关联表</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {selectedRecords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedRecords.map((record) => (
            <Badge key={record.id} variant="secondary" className="gap-1 pr-1">
              <Link2 className="h-3 w-3" />
              {record.title}
              <button
                type="button"
                onClick={() => handleRemoveRecord(record.id)}
                className="ml-1 hover:bg-muted rounded-full p-0.5"
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
