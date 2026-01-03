import { FileUp, Loader2, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { useCallback, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type ImportCsvDialogProps = {
  onImport: (data: { tableName: string; csvData: string }) => Promise<void>;
  trigger?: React.ReactNode;
};

export function ImportCsvDialog({ onImport, trigger }: ImportCsvDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [tableName, setTableName] = useState('');
  const [preview, setPreview] = useState<{
    headers: string[];
    rows: Record<string, string>[];
    totalRows: number;
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setTableName('');
    setPreview(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);

    // 自动从文件名生成表名
    const nameWithoutExt = selectedFile.name.replace(/\.csv$/i, '');
    setTableName(nameWithoutExt);

    // 解析 CSV 预览
    Papa.parse<Record<string, string>>(selectedFile, {
      header: true,
      skipEmptyLines: 'greedy',
      preview: 5, // 只预览前 5 行
      complete: (results) => {
        if (results.errors.length > 0) {
          setError(`CSV parse error: ${results.errors[0].message}`);
          return;
        }
        setPreview({
          headers: results.meta.fields ?? [],
          rows: results.data,
          totalRows: -1, // 未知总行数
        });
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
      },
    });
  }, []);

  const handleImport = useCallback(async () => {
    if (!file || !tableName.trim()) return;

    setIsImporting(true);
    setError(null);

    try {
      // Read file as text
      const csvData = await file.text();
      if (!csvData.trim()) {
        throw new Error('CSV file is empty');
      }

      await onImport({
        tableName: tableName.trim(),
        csvData,
      });

      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  }, [file, tableName, onImport, reset]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        reset();
      }
    },
    [reset]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="text-xs">
            <FileUp className="mr-1.5 h-3.5 w-3.5" />
            Import CSV
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to create a new table. All columns will be created as text fields.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* File Input */}
          <div className="grid gap-2">
            <Label htmlFor="csv-file">CSV File</Label>
            <div
              className="relative flex min-h-[120px] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50 transition-colors hover:border-muted-foreground/50 hover:bg-muted"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="sr-only"
              />
              <div className="flex flex-col items-center gap-2 text-center">
                <Upload className="h-8 w-8 text-muted-foreground/50" />
                {file ? (
                  <div>
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-muted-foreground">Click to upload CSV file</p>
                    <p className="text-xs text-muted-foreground/70">or drag and drop</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Table Name Input */}
          {file && (
            <div className="grid gap-2">
              <Label htmlFor="table-name">Table Name</Label>
              <Input
                id="table-name"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="Enter table name"
              />
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="grid gap-2">
              <Label>Preview ({preview.headers.length} columns)</Label>
              <div className="max-h-[200px] overflow-auto rounded-md border bg-muted/30">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      {preview.headers.map((header, i) => (
                        <th
                          key={i}
                          className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium"
                        >
                          {header || `Column ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-b last:border-0">
                        {preview.headers.map((header, colIndex) => (
                          <td
                            key={colIndex}
                            className="whitespace-nowrap px-2 py-1 text-muted-foreground"
                          >
                            {row[header] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">Showing first 5 rows</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isImporting}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!file || !tableName.trim() || isImporting}>
            {isImporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <FileUp className="mr-2 h-4 w-4" />
                Import
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
