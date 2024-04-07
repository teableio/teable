import { AnchorProvider } from '../../../../context';
import { useTranslation } from '../../../../context/app/i18n';
import { SocketRecordList } from '../../../record-list';
import type { IFilterLinkSelectListProps } from './types';

export const DefaultList = (props: IFilterLinkSelectListProps) => {
  const { field, value, onClick } = props;
  const { t } = useTranslation();

  const isSingle = typeof value === 'string';
  const values = isSingle ? [value] : value;

  return (
    <AnchorProvider tableId={field.options.foreignTableId} fallback={<h1>{t('common.empty')}</h1>}>
      <SocketRecordList
        selectedRecordIds={values || undefined}
        onClick={(value) => {
          onClick(value.id);
        }}
        primaryFieldId={field.options.lookupFieldId}
      />
    </AnchorProvider>
  );
};
