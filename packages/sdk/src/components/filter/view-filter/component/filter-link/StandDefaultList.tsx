import { StandaloneViewProvider } from '../../../../../context';
import { useTranslation } from '../../../../../context/app/i18n';
import { useBaseId } from '../../../../../hooks/use-base-id';
import { SocketRecordList } from '../../../../record-list';
import { StorageLinkSelected } from './storage';
import type { IFilterLinkSelectListProps } from './types';

export const StandDefaultList = (props: IFilterLinkSelectListProps) => {
  const { field, value, onClick } = props;
  const { t } = useTranslation();
  const baseId = useBaseId();

  const isSingle = typeof value === 'string';
  const values = isSingle ? [value] : value;

  return (
    <StandaloneViewProvider
      baseId={baseId}
      tableId={field.options.foreignTableId}
      fallback={<h1>{t('common.empty')}</h1>}
    >
      <SocketRecordList
        selectedRecordIds={values || undefined}
        onClick={(value) => {
          onClick(value.id);
          StorageLinkSelected.set(`${field.options.foreignTableId}-${value.id}`, value.title);
        }}
        lookupFieldId={field.options.lookupFieldId}
      />
    </StandaloneViewProvider>
  );
};
