import { Discord, InIcon, Twitter } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';

/** Share a template's link on X, LinkedIn or Discord: the buttons a host can replace. */
export const TemplateShareButtons = ({ title, shareUrl }: { title: string; shareUrl: string }) => {
  const { t } = useTranslation('space');

  const shareToX = () => {
    const text = encodeURIComponent(`Check out this template: ${title}`);
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(shareUrl)}`,
      '_blank'
    );
  };

  const shareToLinkedIn = () => {
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
      '_blank'
    );
  };

  const shareToDiscord = () => {
    // Discord doesn't have a direct share URL, so we just copy the URL
    navigator.clipboard.writeText(shareUrl);
    toast.success(t('publishBase.urlCopiedForDiscord'));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">{t('publishBase.shareWith')}</div>
      <div className="flex gap-3">
        <Button size="lg" variant="outline" className="size-9 rounded-lg p-0" onClick={shareToX}>
          <Twitter className="size-6 p-0.5" />
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="size-9 rounded-lg p-0"
          onClick={shareToLinkedIn}
        >
          <InIcon className="size-6 fill-[#0A66C2] p-0.5" />
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="size-9 rounded-lg p-0"
          onClick={shareToDiscord}
        >
          <Discord className="size-6 fill-[#5865F2] p-0.5" />
        </Button>
      </div>
    </div>
  );
};
