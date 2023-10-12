import { axios } from '@teable-group/openapi';
import { Spin } from '@teable-group/ui-lib/base';
import { Button, Input, Label, Separator, useToast } from '@teable-group/ui-lib/shadcn';
import { useCallback, useState } from 'react';
export const System: React.FC = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const importFromUrl = useCallback(async () => {
    if (!url) {
      toast({
        variant: 'destructive',
        title: 'url is required',
      });
      return;
    }
    setLoading(true);
    try {
      await axios.post('/export-import/import', { url });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'upload error',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        description: (e as any).message,
      });
    } finally {
      setLoading(false);
    }
    toast({
      variant: 'default',
      title: 'Import successfully',
    });
    if (typeof window === 'object') {
      window.location.pathname = '/space';
    }
  }, [toast, url]);
  return (
    <div className="flex flex-col gap-2 px-6">
      <div className="space-y-2">
        <h1 className="font-semibold leading-none tracking-tight">System</h1>
        <p className="text-sm">
          Upload your .db file here, it will auto import and replace your workspace
        </p>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="dbUrl">Input .teable file url</Label>
          <Input
            id="dbUrl"
            placeholder="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button type="submit" onClick={importFromUrl}>
            {loading ? <Spin /> : 'Import'}
          </Button>
        </div>
        <Separator />
        <div className="space-y-2">
          <Label htmlFor="exportDb">Export current workspace to a .teable file</Label>

          <Button id="exportDb" asChild>
            <a href="/api/export-import/download" target="__blank">
              Export
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
};
