import { useQuery } from '@tanstack/react-query';
import type { ILinkFieldOptionsRo } from '@teable/core';
import { Relationship } from '@teable/core';
import { getTablePermission } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase, useTableId, useTables } from '@teable/sdk/hooks';
import { Selector } from '@teable/ui-lib/base';
import { Label, Switch } from '@teable/ui-lib/shadcn';
import { Trans, useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

export const LinkOptions = (props: {
  options: Partial<ILinkFieldOptionsRo> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<ILinkFieldOptionsRo>) => void;
}) => {
  const { options, isLookup, onChange } = props;
  const tableId = useTableId();
  const tables = useTables();
  const baseId = useBase().id;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const relationship = options?.relationship ?? Relationship.ManyOne;
  const foreignTableId = options?.foreignTableId;
  const isOneWay = options?.isOneWay;

  const { data: tablePermission } = useQuery({
    refetchOnWindowFocus: false,
    queryKey: ReactQueryKeys.getTablePermission(baseId, foreignTableId!),
    enabled: !!foreignTableId,
    queryFn: ({ queryKey }) => getTablePermission(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  const canCreateField = tablePermission?.field.create;

  const translation = {
    [Relationship.OneOne]: t('table:field.editor.oneToOne'),
    [Relationship.OneMany]: t('table:field.editor.oneToMany'),
    [Relationship.ManyOne]: t('table:field.editor.manyToOne'),
    [Relationship.ManyMany]: t('table:field.editor.manyToMany'),
  };

  const onSelect = (key: keyof ILinkFieldOptionsRo, value: unknown) => {
    onChange?.({ foreignTableId, relationship, isOneWay, [key]: value });
  };

  const onRelationshipChange = (leftMulti: boolean, rightMulti: boolean) => {
    if (leftMulti && rightMulti) {
      onSelect('relationship', Relationship.ManyMany);
    }
    if (leftMulti && !rightMulti) {
      onSelect('relationship', Relationship.OneMany);
    }
    if (!leftMulti && rightMulti) {
      onSelect('relationship', Relationship.ManyOne);
    }
    if (!leftMulti && !rightMulti) {
      onSelect('relationship', Relationship.OneOne);
    }
  };

  const isLeftMulti = (relationship: Relationship) => {
    return relationship === Relationship.ManyMany || relationship === Relationship.OneMany;
  };
  const isRightMulti = (relationship: Relationship) => {
    return relationship === Relationship.ManyMany || relationship === Relationship.ManyOne;
  };

  if (isLookup) {
    return <></>;
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <span className="neutral-content label-text">{t('table:field.editor.linkTable')}</span>
      <Selector
        selectedId={foreignTableId}
        onChange={(foreignTableId) => onSelect('foreignTableId', foreignTableId)}
        candidates={tables.map((table) => ({
          id: table.id,
          name: table.name + (tableId === table.id ? ` (${t('table:field.editor.self')})` : ''),
        }))}
        placeholder={t('table:field.editor.selectTable')}
      />
      {foreignTableId && (
        <>
          <hr className="my-2" />
          <div className="flex space-x-2 pt-1">
            <Switch
              id="field-options-one-way-link"
              checked={!isOneWay}
              onCheckedChange={(checked) => {
                onSelect('isOneWay', checked ? undefined : true);
              }}
              disabled={!canCreateField}
            />
            <Label htmlFor="field-options-one-way-link" className="font-normal leading-tight">
              {t('table:field.editor.createSymmetricLink')}
            </Label>
          </div>
          <div className="flex space-x-2 pt-1">
            <Switch
              id="field-options-self-multi"
              checked={isLeftMulti(relationship)}
              onCheckedChange={(checked) => {
                onRelationshipChange(checked, isRightMulti(relationship));
              }}
            />
            <Label htmlFor="field-options-self-multi" className="font-normal leading-tight">
              {t('table:field.editor.allowLinkMultipleRecords')}
            </Label>
          </div>
          <div className="flex space-x-2 pt-1">
            <Switch
              id="field-options-sym-multi"
              checked={isRightMulti(relationship)}
              onCheckedChange={(checked) => {
                onRelationshipChange(isLeftMulti(relationship), checked);
              }}
            />
            <Label htmlFor="field-options-sym-multi" className="font-normal leading-tight">
              {isOneWay
                ? t('table:field.editor.allowLinkToDuplicateRecords')
                : t('table:field.editor.allowSymmetricFieldLinkMultipleRecords')}
            </Label>
          </div>
          <p className="pt-2">
            <Trans
              ns="table"
              i18nKey="field.editor.linkTipMessage"
              components={{ b: <b />, span: <span />, br: <br /> }}
              values={{
                relationship: translation[relationship],
                linkType:
                  tableId === foreignTableId
                    ? t('table:field.editor.inSelfLink')
                    : t('table:field.editor.betweenTwoTables'),
              }}
            />
          </p>
        </>
      )}
    </div>
  );
};
