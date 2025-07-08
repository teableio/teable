import { LinkViewProvider, RowCountProvider } from '../../../../../context';
import { useTranslation } from '../../../../../context/app/i18n';
import { LinkFilterProvider } from '../../../../../context/query/LinkFilterProvider';
import { SocketRecordList } from '../../../../record-list';
import { StorageLinkSelected } from './storage';
import type { IFilterLinkSelectListProps } from './types';

export const DefaultList = (props: IFilterLinkSelectListProps) => {
  const { field, value, onClick } = props;
  const { t } = useTranslation();

  const isSingle = typeof value === 'string';
  const values = isSingle ? [value] : value;

  return (
    <LinkViewProvider linkFieldId={field.id} fallback={<h1>{t('common.empty')}</h1>}>
      <LinkFilterProvider filterLinkCellSelected={field.id}>
        <RowCountProvider>
          <SocketRecordList
            selectedRecordIds={values || undefined}
            onClick={(value) => {
              onClick(value.id);
              StorageLinkSelected.set(`${field.options.foreignTableId}-${value.id}`, value.title);
            }}
            lookupFieldId={field.options.lookupFieldId}
          />
        </RowCountProvider>
      </LinkFilterProvider>
    </LinkViewProvider>
  );
};
