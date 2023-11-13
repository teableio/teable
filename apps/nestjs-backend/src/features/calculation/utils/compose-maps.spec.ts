import { composeMaps } from './compose-maps';
describe('composeMaps', () => {
  it('should return an empty object when no maps are provided', () => {
    expect(composeMaps([])).toEqual({});
  });

  it('should return the same map if only one map is provided', () => {
    const singleMap = {
      table1: {
        record1: [{ p: [1, 2], otherProps: 'value' }],
      },
    };
    expect(composeMaps([singleMap])).toEqual(singleMap);
  });

  it('should merge maps without overlapping keys correctly', () => {
    const map1 = {
      table1: {
        record1: [{ p: [1], value: 'a' }],
      },
    };
    const map2 = {
      table2: {
        record2: [{ p: [2], value: 'b' }],
      },
    };
    const expected = {
      table1: {
        record1: [{ p: [1], value: 'a' }],
      },
      table2: {
        record2: [{ p: [2], value: 'b' }],
      },
    };
    expect(composeMaps([map1, map2])).toEqual(expected);
  });

  it('should overwrite operations with the same "p" value in the same record', () => {
    const map1 = {
      table1: {
        record1: [{ p: [1], value: 'a' }],
      },
    };
    const map2 = {
      table1: {
        record1: [{ p: [1], value: 'b' }],
      },
    };
    const expected = {
      table1: {
        record1: [{ p: [1], value: 'b' }],
      },
    };
    expect(composeMaps([map1, map2])).toEqual(expected);
  });

  it('should overwrite 3 operations with the same "p" value in the same record', () => {
    const map1 = {
      table1: {
        record1: [{ p: [1], value: 'a' }],
      },
    };
    const map2 = {
      table1: {
        record1: [{ p: [1], value: 'b' }],
      },
    };
    const map3 = {
      table1: {
        record1: [{ p: [1], value: 'c' }],
      },
    };
    const expected = {
      table1: {
        record1: [{ p: [1], value: 'c' }],
      },
    };
    expect(composeMaps([map1, map2, map3])).toEqual(expected);
  });

  it('should append operations with different "p" values in the same record', () => {
    const map1 = {
      table1: {
        record1: [{ p: [1], value: 'a' }],
      },
    };
    const map2 = {
      table1: {
        record1: [{ p: [2], value: 'b' }],
      },
    };
    const expected = {
      table1: {
        record1: [
          { p: [1], value: 'a' },
          { p: [2], value: 'b' },
        ],
      },
    };
    expect(composeMaps([map1, map2])).toEqual(expected);
  });
});
