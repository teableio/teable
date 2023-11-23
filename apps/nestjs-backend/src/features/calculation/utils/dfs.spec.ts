import { buildAdjacencyMap, buildCompressedAdjacencyMap } from './dfs';

describe('Graph Processing Functions', () => {
  describe('buildAdjacencyMap', () => {
    it('should create an adjacency map from a graph', () => {
      const graph = [
        { fromFieldId: 'a', toFieldId: 'b' },
        { fromFieldId: 'b', toFieldId: 'c' },
      ];
      const expected = {
        a: ['b'],
        b: ['c'],
      };
      expect(buildAdjacencyMap(graph)).toEqual(expected);
    });

    it('should handle graphs with multiple edges from a single node', () => {
      const graph = [
        { fromFieldId: 'a', toFieldId: 'b' },
        { fromFieldId: 'a', toFieldId: 'c' },
      ];
      const expected = {
        a: ['b', 'c'],
      };
      expect(buildAdjacencyMap(graph)).toEqual(expected);
    });

    it('should return an empty object for an empty graph', () => {
      expect(buildAdjacencyMap([])).toEqual({});
    });
  });

  describe('buildCompressedAdjacencyMap', () => {
    it('should compress a graph based on linkIdSet', () => {
      const graph = [
        { fromFieldId: 'id1', toFieldId: 'id2' },
        { fromFieldId: 'id2', toFieldId: 'id3' },
        { fromFieldId: 'id2', toFieldId: 'id4' },
        { fromFieldId: 'id3', toFieldId: 'id5' },
      ];
      const linkIdSet = new Set(['id2', 'id4', 'id5']);
      const expected = {
        id1: ['id2'],
        id2: ['id5', 'id4'],
        id3: ['id5'],
      };
      expect(buildCompressedAdjacencyMap(graph, linkIdSet)).toEqual(expected);
    });

    it('should handle empty linkIdSet', () => {
      const graph = [
        { fromFieldId: 'id1', toFieldId: 'id2' },
        { fromFieldId: 'id2', toFieldId: 'id3' },
      ];
      expect(buildCompressedAdjacencyMap(graph, new Set())).toEqual({});
    });

    it('should handle graphs with no valid paths', () => {
      const graph = [
        { fromFieldId: 'id1', toFieldId: 'id2' },
        { fromFieldId: 'id2', toFieldId: 'id3' },
      ];
      const linkIdSet = new Set(['id4']);
      expect(buildCompressedAdjacencyMap(graph, linkIdSet)).toEqual({});
    });
  });

  describe('buildCompressedAdjacencyMap with unordered graph', () => {
    it('should handle graphs with unordered edges', () => {
      const graph = [
        { fromFieldId: 'id3', toFieldId: 'id5' },
        { fromFieldId: 'id1', toFieldId: 'id2' },
        { fromFieldId: 'id2', toFieldId: 'id4' },
        { fromFieldId: 'id2', toFieldId: 'id3' },
      ];
      const linkIdSet = new Set(['id2', 'id4', 'id5']);
      const expected = {
        id1: ['id2'],
        id2: ['id4', 'id5'],
        id3: ['id5'],
      };
      expect(buildCompressedAdjacencyMap(graph, linkIdSet)).toEqual(expected);
    });
  });
});
