import type { IAttachmentCellValue } from '@teable/core';
import { Image } from '@teable/icons';
import { useTheme } from '@teable/next-themes';
import { CellValue, getFileCover, isSystemFileIcon } from '@teable/sdk/components';
import { useFieldStaticGetter } from '@teable/sdk/hooks';
import type { IFieldInstance, Record } from '@teable/sdk/model';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface IPresentationSlideProps {
  card?: Record;
  primaryField: IFieldInstance | null;
  displayFields: IFieldInstance[];
  coverField?: IFieldInstance;
  isCoverFit?: boolean;
  isFieldNameHidden?: boolean;
}

const PresentationCover = ({
  value,
  isCoverFit,
}: {
  value?: IAttachmentCellValue;
  isCoverFit?: boolean;
}) => {
  const { resolvedTheme } = useTheme();
  const first = value?.[0];

  if (!first) {
    return (
      <div className="flex h-[36vh] min-h-[220px] w-full items-center justify-center bg-muted/60">
        <Image className="size-24 text-muted-foreground/40" />
      </div>
    );
  }

  const isSystemFile = isSystemFileIcon(first.mimetype);
  const url =
    first.lgThumbnailUrl ??
    getFileCover(first.mimetype, first.presignedUrl, resolvedTheme as 'light' | 'dark');

  return (
    <div className="relative h-[36vh] min-h-[220px] w-full overflow-hidden bg-muted/40">
      <img
        src={url}
        alt=""
        className={cn('size-full', isSystemFile ? 'object-contain p-10' : 'size-full')}
        style={{ objectFit: isCoverFit || isSystemFile ? 'contain' : 'cover' }}
      />
    </div>
  );
};

export const PresentationSlide = (props: IPresentationSlideProps) => {
  const { card, primaryField, displayFields, coverField, isCoverFit, isFieldNameHidden } = props;
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const titleComponent = useMemo(() => {
    if (primaryField == null || card == null) {
      return <span className="text-muted-foreground">{t('untitled')}</span>;
    }
    const value = card.getCellValue(primaryField.id);
    if (value == null) {
      return <span className="text-muted-foreground">{t('untitled')}</span>;
    }
    return <CellValue field={primaryField} value={value} className="text-4xl md:text-5xl" />;
  }, [card, primaryField, t]);

  const coverCellValue = coverField
    ? (card?.getCellValue(coverField.id) as IAttachmentCellValue | undefined)
    : undefined;

  return (
    <article className="flex min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border">
      {coverField && <PresentationCover value={coverCellValue} isCoverFit={isCoverFit} />}
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto p-10 md:px-16 md:py-12">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          {titleComponent}
        </h1>
        <div className="flex flex-col gap-7">
          {displayFields.map((field) => {
            const { id: fieldId, name, type, isLookup, isConditionalLookup, aiConfig } = field;
            const { Icon } = getFieldStatic(type, {
              isLookup,
              isConditionalLookup,
              hasAiConfig: Boolean(aiConfig),
              deniedReadRecord: !field.canReadFieldRecord,
            });
            const cellValue = card?.getCellValue(fieldId);

            return (
              <div key={fieldId} className="space-y-2">
                {!isFieldNameHidden && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Icon className="size-5" />
                    <span className="text-sm font-medium uppercase tracking-wide">{name}</span>
                  </div>
                )}
                {cellValue != null ? (
                  <CellValue field={field} value={cellValue} className="text-2xl leading-snug" />
                ) : (
                  <div className="text-2xl text-muted-foreground/50">-</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
};
