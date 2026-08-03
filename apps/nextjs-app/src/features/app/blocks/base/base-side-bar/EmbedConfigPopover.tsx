import { Copy } from '@teable/icons';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { ChevronRight, Eye } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

const getEmbedUrl = (shareUrl: string) => {
  const url = new URL(shareUrl);
  url.searchParams.append('embed', 'true');
  return url.toString();
};

const getEmbedHtml = (shareUrl: string) => {
  const embedUrl = getEmbedUrl(shareUrl);
  return `<iframe src="${embedUrl}" width="100%" height="533" style="border: 0"></iframe>`;
};

export const EmbedConfigPopover = ({ shareUrl }: { shareUrl: string }) => {
  const { t } = useTranslation(['common']);
  const [previewOpen, setPreviewOpen] = useState(false);

  const embedHtml = getEmbedHtml(shareUrl);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(embedHtml);
    toast.success(t('common:actions.copySuccess'));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="-mx-2 flex w-[calc(100%+16px)] items-center justify-between px-2 py-1"
        >
          <Label className="cursor-pointer text-sm font-normal">
            {t('common:baseShare.embedConfig')}
          </Label>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80">
        <div className="mb-3 rounded-md border bg-muted p-3">
          <code className="break-all text-xs">{embedHtml}</code>
        </div>

        <div className="flex gap-2">
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="size-4 shrink-0" />
              {t('common:baseShare.embedPreview')}
            </Button>
            <DialogContent className="sm:max-w-[425px] md:max-w-[600px] lg:max-w-[800px]">
              <DialogHeader>
                <DialogTitle>{t('common:baseShare.embedPreview')}</DialogTitle>
              </DialogHeader>
              <div className="h-[500px] overflow-hidden rounded-md border">
                <iframe
                  src={getEmbedUrl(shareUrl)}
                  title="embed preview"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                />
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" className="flex-1" onClick={handleCopyCode}>
            <Copy className="size-4 shrink-0" />
            {t('common:baseShare.copyCode')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
