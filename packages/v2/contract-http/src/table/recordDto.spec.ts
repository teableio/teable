import {
  GetRecordByIdResult,
  ListTableRecordsResult,
  type TableRecordReadModel,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { getRecordByIdResponseDataSchema, mapGetRecordByIdResultToDto } from './getRecordById';
import {
  listTableRecordsResponseDataSchema,
  mapListTableRecordsResultToDto,
} from './listTableRecords';

const unknownRecord = (): TableRecordReadModel => ({
  id: 'rec1111111111111111',
  version: 4,
  fields: { fldTitle: 'Legacy row', fldUndefined: undefined },
  createdByActorType: null,
  createdByActorId: null,
  lastModifiedByActorType: null,
  lastModifiedByActorId: null,
});

describe('physical actor response serialization', () => {
  it('keeps all four nullable properties and the row in disabled/unknown get responses', () => {
    const mapped = mapGetRecordByIdResultToDto(
      GetRecordByIdResult.create(unknownRecord())
    )._unsafeUnwrap();
    const parsed = getRecordByIdResponseDataSchema.parse(JSON.parse(JSON.stringify(mapped)));
    expect(parsed.record).toEqual({
      id: 'rec1111111111111111',
      fields: { fldTitle: 'Legacy row' },
      createdByActorType: null,
      createdByActorId: null,
      lastModifiedByActorType: null,
      lastModifiedByActorId: null,
    });
  });

  it('preserves physical actors through the list consumer schema without turning them into cells', () => {
    const row: TableRecordReadModel = {
      ...unknownRecord(),
      createdBy: 'usrRobot',
      createdByActorType: 'appUser',
      createdByActorId: 'apu_stable_principal',
      lastModifiedByActorType: 'automation',
      lastModifiedByActorId: 'wflStableWorkflow',
    };
    const result = ListTableRecordsResult.create([row, unknownRecord()], 2, 0, 10);
    const parsed = listTableRecordsResponseDataSchema.parse(
      JSON.parse(JSON.stringify(mapListTableRecordsResultToDto(result)._unsafeUnwrap()))
    );
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({
      createdByActorType: 'appUser',
      createdByActorId: 'apu_stable_principal',
      lastModifiedByActorType: 'automation',
      lastModifiedByActorId: 'wflStableWorkflow',
      fields: { fldTitle: 'Legacy row' },
    });
    expect(parsed.records[0].fields).not.toHaveProperty('createdByActorType');
    expect(parsed.records[1].lastModifiedByActorId).toBeNull();
  });
});
