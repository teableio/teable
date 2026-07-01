import { mapAirtableRollupAggregation } from './airtable-rollup-mapper';

describe('mapAirtableRollupAggregation', () => {
  it('maps every Airtable rollup function to its Teable counterpart', () => {
    const cases: Array<[string, string]> = [
      ['SUM(values)', 'sum({values})'],
      ['AVERAGE(values)', 'average({values})'],
      ['MAX(values)', 'max({values})'],
      ['MIN(values)', 'min({values})'],
      ['COUNT(values)', 'count({values})'],
      ['COUNTA(values)', 'counta({values})'],
      ['COUNTALL(values)', 'countall({values})'],
      ['AND(values)', 'and({values})'],
      ['OR(values)', 'or({values})'],
      ['XOR(values)', 'xor({values})'],
      ['ARRAYUNIQUE(values)', 'array_unique({values})'],
      ['ARRAYCOMPACT(values)', 'array_compact({values})'],
      ['CONCATENATE(values)', 'concatenate({values})'],
    ];
    for (const [airtable, teable] of cases) {
      expect(mapAirtableRollupAggregation(airtable)).toBe(teable);
    }
  });

  it("drops ARRAYJOIN's separator argument (Teable joins with a comma)", () => {
    expect(mapAirtableRollupAggregation('ARRAYJOIN(values)')).toBe('array_join({values})');
    expect(mapAirtableRollupAggregation('ARRAYJOIN(values, "; ")')).toBe('array_join({values})');
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(mapAirtableRollupAggregation('  sum( values ) ')).toBe('sum({values})');
  });

  it('returns null for compound or custom aggregations so the importer snapshots them', () => {
    expect(mapAirtableRollupAggregation('SUM(values) * 2')).toBeNull();
    expect(mapAirtableRollupAggregation('ROUND(AVERAGE(values), 1)')).toBeNull();
    expect(mapAirtableRollupAggregation('SUM(values) / COUNTA(values)')).toBeNull();
  });

  it('returns null for an unsupported function', () => {
    expect(mapAirtableRollupAggregation('MEDIAN(values)')).toBeNull();
  });
});
