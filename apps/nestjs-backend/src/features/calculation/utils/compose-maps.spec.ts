import { composeOpMaps } from './compose-maps';
describe('composeMaps', () => {
  it('should return an empty object when no maps are provided', () => {
    expect(composeOpMaps([])).toEqual({});
  });

  it('should merge maps without overlapping keys correctly', () => {
    const map1 = {
      table1: {
        record1: [{ p: [1], oi: 'a' }],
      },
    };
    const map2 = {
      table2: {
        record2: [{ p: [2], oi: 'b' }],
      },
    };

    const expected = {
      table1: {
        record1: [{ p: [1], oi: 'a' }],
      },
      table2: {
        record2: [{ p: [2], oi: 'b' }],
      },
    };
    expect(composeOpMaps([map1, map2])).toEqual(expected);
  });

  it('should overwrite operations with the same "p" value in the same record', () => {
    const map1 = {
      table1: {
        record1: [{ p: [1], oi: 'a', od: 'x' }],
      },
    };
    const map2 = {
      table1: {
        record1: [{ p: [1], oi: 'b', od: 'a' }],
      },
    };
    const expected = {
      table1: {
        record1: [{ p: [1], oi: 'b', od: 'x' }],
      },
    };
    expect(composeOpMaps([map1, map2])).toEqual(expected);
  });

  it('should filter operations with the same oi od in 1 map', () => {
    const map1 = {
      table1: {
        record1: [{ p: [1], oi: 'a', od: 'a' }],
      },
    };
    const expected = {};
    expect(composeOpMaps([map1])).toEqual(expected);
  });

  it('should filter operations with the same oi od in 2 map', () => {
    const map1 = {
      table1: {
        record1: [{ p: [1], oi: 'a', od: 'x' }],
      },
    };
    const map2 = {
      table1: {
        record1: [{ p: [1], oi: 'x', od: 'a' }],
      },
    };
    const expected = {};
    expect(composeOpMaps([map1, map2])).toEqual(expected);
  });

  it('should overwrite 3 operations with the same "p" value in the same record', () => {
    const map1 = {
      table1: {
        record1: [{ p: [1], oi: 'a' }],
      },
    };
    const map2 = {
      table1: {
        record1: [{ p: [1], oi: 'b' }],
      },
    };
    const map3 = {
      table1: {
        record1: [{ p: [1], oi: 'c' }],
      },
    };
    const expected = {
      table1: {
        record1: [{ p: [1], oi: 'c' }],
      },
    };
    expect(composeOpMaps([map1, map2, map3])).toEqual(expected);
  });

  it('should append operations with different "p" values in the same record', () => {
    const map1 = {
      table1: {
        record1: [{ p: [1], oi: 'a' }],
      },
    };
    const map2 = {
      table1: {
        record1: [{ p: [2], oi: 'b' }],
      },
    };
    const expected = {
      table1: {
        record1: [
          { p: [1], oi: 'a' },
          { p: [2], oi: 'b' },
        ],
      },
    };
    expect(composeOpMaps([map1, map2])).toEqual(expected);
  });
});
