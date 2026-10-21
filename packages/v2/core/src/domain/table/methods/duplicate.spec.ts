import { describe, expect, it } from 'vitest';

import { DefaultTableMapper } from '../../../ports/mappers/defaults/DefaultTableMapper';
import type { ITablePersistenceDTO } from '../../../ports/mappers/TableMapper';
import { BaseId } from '../../base/BaseId';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableName } from '../TableName';

const tableMapper = new DefaultTableMapper();

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Gallery copy')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().singleLineText().withName(FieldName.create('Subtitle')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  builder.view().gallery().defaultName().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table.duplicate', () => {
  it('keeps the duplicated gallery primary column visible without changing other metadata', () => {
    const table = buildTable();
    const dto = tableMapper.toDTO(table)._unsafeUnwrap();
    const gallery = dto.views.find((view) => view.type === 'gallery')!;
    const primaryFieldId = dto.primaryFieldId;
    const secondaryFieldId = dto.fields[1]!.id;
    const historicalDto: ITablePersistenceDTO = {
      ...dto,
      views: dto.views.map((view) =>
        view.id === gallery.id
          ? ({
              ...view,
              type: 'gallery',
              columnMeta: {
                [primaryFieldId]: {
                  ...view.columnMeta[primaryFieldId],
                  order: 0,
                  width: 260,
                  visible: false,
                },
                [secondaryFieldId]: {
                  ...view.columnMeta[secondaryFieldId],
                  order: 1,
                  width: 120,
                  visible: false,
                },
              },
            } as ITablePersistenceDTO['views'][number])
          : view
      ),
    };

    const duplicated = tableMapper
      .toDomain(historicalDto)
      ._unsafeUnwrap()
      .duplicate({
        mapper: tableMapper,
        newName: TableName.create('Gallery copy 2')._unsafeUnwrap(),
      })
      ._unsafeUnwrap();

    const duplicatedPrimaryId = duplicated.fieldIdMap.get(primaryFieldId)!;
    const duplicatedSecondaryId = duplicated.fieldIdMap.get(secondaryFieldId)!;
    const duplicatedGallery = duplicated.table
      .views()
      .find((view) => view.type().toString() === 'gallery')!;
    const columnMeta = duplicatedGallery.columnMeta()._unsafeUnwrap().toDto();

    expect(columnMeta[duplicatedPrimaryId]).toEqual({ order: 0, width: 260, visible: true });
    expect(columnMeta[duplicatedSecondaryId]).toEqual({ order: 1, width: 120, visible: false });
  });
});
