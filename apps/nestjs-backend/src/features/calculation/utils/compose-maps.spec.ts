import { composeMaps } from './compose-maps';

describe('composeMaps', () => {
  it('should correctly merge maps with overlapping keys', () => {
    const opsMaps: { [x: string]: { [y: string]: string[] } }[] = [
      {
        table1: {
          record1: ['A'],
          record2: ['B'],
        },
      },
      {
        table1: {
          record2: ['C'],
          record3: ['D'],
        },
      },
    ];

    const expected = {
      table1: {
        record1: ['A'],
        record2: ['B', 'C'],
        record3: ['D'],
      },
    };

    expect(composeMaps(opsMaps)).toEqual(expected);
  });

  it('should correctly merge maps without overlapping keys', () => {
    const opsMaps: { [x: string]: { [y: string]: string[] } }[] = [
      {
        table1: {
          record1: ['A'],
          record2: ['B'],
        },
      },
      {
        table2: {
          record3: ['C'],
          record4: ['D'],
        },
      },
    ];

    const expected = {
      table1: {
        record1: ['A'],
        record2: ['B'],
      },
      table2: {
        record3: ['C'],
        record4: ['D'],
      },
    };

    expect(composeMaps(opsMaps)).toEqual(expected);
  });

  it('should correctly handle empty input', () => {
    const opsMaps = [undefined, undefined, undefined];

    const expected = {};

    expect(composeMaps(opsMaps)).toEqual(expected);
  });

  it('should correctly handle input with both defined and undefined maps', () => {
    const opsMaps: ({ [x: string]: { [y: string]: string[] } } | undefined)[] = [
      {
        table1: {
          record1: ['A'],
          record2: ['B'],
        },
      },
      undefined,
      {
        table1: {
          record2: ['C'],
          record3: ['D'],
        },
      },
    ];

    const expected = {
      table1: {
        record1: ['A'],
        record2: ['B', 'C'],
        record3: ['D'],
      },
    };

    expect(composeMaps(opsMaps)).toEqual(expected);
  });
});
