import { describe, expect, it } from 'vitest';
import { GUIDE_SPOTLIGHT_PENDING_TTL, resolveGuideSpotlight } from './guideSpotlight';

const request = { tableId: 'tblA', fieldId: 'fldName', requestedAt: 1000 };
const ready = {
  request,
  tableId: 'tblA',
  fieldsTableId: 'tblA',
  columns: [{ id: 'fldPrimary' }, { id: 'fldName' }],
  hasFirstRecord: true,
  now: 2000,
};

describe('resolveGuideSpotlight', () => {
  it('points at the column of the requested field once the first record is loaded', () => {
    expect(resolveGuideSpotlight(ready)).toEqual({ columnIndex: 1 });
  });

  it('waits while another table is open', () => {
    expect(resolveGuideSpotlight({ ...ready, tableId: 'tblB', fieldsTableId: 'tblB' })).toBe(
      'wait'
    );
  });

  it('waits while the fields still belong to the previous table', () => {
    expect(
      resolveGuideSpotlight({ ...ready, fieldsTableId: 'tblB', columns: [{ id: 'fldOther' }] })
    ).toBe('wait');
    expect(resolveGuideSpotlight({ ...ready, fieldsTableId: undefined })).toBe('wait');
  });

  it('waits for the first record', () => {
    expect(resolveGuideSpotlight({ ...ready, hasFirstRecord: false })).toBe('wait');
  });

  it('drops the request when the field is hidden or missing', () => {
    expect(resolveGuideSpotlight({ ...ready, columns: [{ id: 'fldPrimary' }] })).toBe('drop');
  });

  it('drops a request no grid picked up in time, even for another table', () => {
    const now = request.requestedAt + GUIDE_SPOTLIGHT_PENDING_TTL + 1;
    expect(resolveGuideSpotlight({ ...ready, now })).toBe('drop');
    expect(resolveGuideSpotlight({ ...ready, tableId: 'tblB', now })).toBe('drop');
  });
});
