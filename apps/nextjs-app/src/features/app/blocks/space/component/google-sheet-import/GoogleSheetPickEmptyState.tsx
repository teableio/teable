import { GoogleSheet } from '@teable/icons';
import { Spin } from '@teable/ui-lib/index';
import { buttonVariants, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

/**
 * The pick step's empty state: the whole card is the click target (a forgiving
 * hit area, like the file tab's drop zone), while the label inside is DRAWN as
 * a button so the clickability reads at a glance — an icon over plain gray
 * text signals nothing until hovered. A solid border on purpose — NOT a
 * dashed drop-zone: nothing can be dropped here, and a dashed border would
 * promise exactly that.
 */
export const GoogleSheetPickEmptyState = ({
  onPick,
  picking,
}: {
  onPick: () => void;
  /** Shows a spinner in the button label while the Picker is being opened. */
  picking?: boolean;
}) => {
  const { t } = useTranslation(['space']);
  return (
    <button
      type="button"
      disabled={picking}
      onClick={onPick}
      className="flex w-full flex-col items-center gap-4 rounded-lg border py-8 transition-colors hover:bg-accent/50"
    >
      <GoogleSheet className="size-9" />
      {/* Visual only — the real button is the whole card around it. */}
      <span className={cn(buttonVariants(), 'pointer-events-none')}>
        {picking && <Spin className="me-1 size-4" />}
        {t('space:googleSheetImport.openPicker')}
      </span>
    </button>
  );
};
