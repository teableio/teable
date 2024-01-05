import type { IGraphItem } from './dfs';
import {
  buildAdjacencyMap,
  buildCompressedAdjacencyMap,
  hasCycle,
  pruneGraph,
  topoOrderWithDepends,
  topoOrderWithStart,
  topologicalSort,
} from './dfs';

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

  describe('topologicalSort', () => {
    it('should perform a basic topological sort', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: 'a', toFieldId: 'b' },
        { fromFieldId: 'b', toFieldId: 'c' },
      ];
      expect(topologicalSort(graph)).toEqual(['a', 'b', 'c']);
    });

    it('should perform a branched topological sort', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: 'a', toFieldId: 'b' },
        { fromFieldId: 'a', toFieldId: 'c' },
        { fromFieldId: 'b', toFieldId: 'c' },
        { fromFieldId: 'b', toFieldId: 'd' },
      ];
      expect(topologicalSort(graph)).toEqual(['a', 'b', 'd', 'c']);
    });

    it('should handle an empty graph', () => {
      const graph: IGraphItem[] = [];
      expect(topologicalSort(graph)).toEqual([]);
    });

    it('should handle a graph with a single circular node', () => {
      const graph: IGraphItem[] = [{ fromFieldId: 'a', toFieldId: 'a' }];
      expect(() => topologicalSort(graph)).toThrowError();
    });

    it('should handle graphs with circular dependencies', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: 'a', toFieldId: 'b' },
        { fromFieldId: 'b', toFieldId: 'a' },
      ];
      expect(() => topologicalSort(graph)).toThrowError();
    });
  });

  describe('topoOrderWithDepends', () => {
    it('should return an empty array for an empty graph', () => {
      const result = topoOrderWithDepends('anyNodeId', []);
      expect(result).toEqual([
        {
          id: 'anyNodeId',
          dependencies: [],
        },
      ]);
    });

    it('should handle circular single node graph correctly', () => {
      const graph: IGraphItem[] = [{ fromFieldId: '1', toFieldId: '1' }];
      expect(() => topoOrderWithDepends('1', graph)).toThrowError();
    });

    it('should handle circular node graph correctly', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: '1', toFieldId: '2' },
        { fromFieldId: '2', toFieldId: '1' },
      ];
      expect(() => topoOrderWithDepends('1', graph)).toThrowError();
    });

    it('should return correct order for a normal DAG', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: '1', toFieldId: '2' },
        { fromFieldId: '2', toFieldId: '3' },
      ];
      const result = topoOrderWithDepends('1', graph);
      expect(result).toEqual([
        { id: '1', dependencies: [] },
        { id: '2', dependencies: ['1'] },
        { id: '3', dependencies: ['2'] },
      ]);
    });

    it('should return correct order for a complex DAG', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: '1', toFieldId: '2' },
        { fromFieldId: '2', toFieldId: '3' },
        { fromFieldId: '1', toFieldId: '3' },
        { fromFieldId: '3', toFieldId: '4' },
      ];
      const result = topoOrderWithDepends('1', graph);
      expect(result).toEqual([
        { id: '1', dependencies: [] },
        { id: '2', dependencies: ['1'] },
        { id: '3', dependencies: ['2', '1'] },
        { id: '4', dependencies: ['3'] },
      ]);
    });
  });

  describe('hasCycle', () => {
    it('should return false for an empty graph', () => {
      expect(hasCycle([])).toBe(false);
    });

    it('should return true for a single node graph link to self', () => {
      const graph = [{ fromFieldId: '1', toFieldId: '1' }];
      expect(hasCycle(graph)).toBe(true);
    });

    it('should return false for a normal DAG without cycles', () => {
      const graph = [
        { fromFieldId: '1', toFieldId: '2' },
        { fromFieldId: '2', toFieldId: '3' },
      ];
      expect(hasCycle(graph)).toBe(false);
    });

    it('should return true for a graph with a cycle', () => {
      const graph = [
        { fromFieldId: '1', toFieldId: '2' },
        { fromFieldId: '2', toFieldId: '3' },
        { fromFieldId: '3', toFieldId: '1' }, // creates a cycle
      ];
      expect(hasCycle(graph)).toBe(true);
    });
  });

  describe('topoOrderWithStart', () => {
    it('should return correct order for a normal DAG', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: '1', toFieldId: '2' },
        { fromFieldId: '2', toFieldId: '3' },
      ];
      const result = topoOrderWithStart('1', graph);
      expect(result).toEqual(['1', '2', '3']);
    });

    it('should return correct order for a complex DAG', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: '1', toFieldId: '2' },
        { fromFieldId: '2', toFieldId: '3' },
        { fromFieldId: '1', toFieldId: '3' },
        { fromFieldId: '3', toFieldId: '4' },
      ];
      const result = topoOrderWithStart('1', graph);
      expect(result).toEqual(['1', '2', '3', '4']);
    });
  });

  describe('pruneGraph', () => {
    test('returns an empty array for an empty graph', () => {
      expect(pruneGraph('A', [])).toEqual([]);
    });

    test('returns correct graph for a single-node graph', () => {
      const graph: IGraphItem[] = [{ fromFieldId: 'A', toFieldId: 'B' }];
      expect(pruneGraph('A', graph)).toEqual(graph);
    });

    test('returns correct graph for a tow-node graph', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: 'A', toFieldId: 'C' },
        { fromFieldId: 'B', toFieldId: 'C' },
      ];
      expect(pruneGraph('C', graph)).toEqual(graph);
    });

    test('returns correct graph for a multi-node graph', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: 'A', toFieldId: 'B' },
        { fromFieldId: 'B', toFieldId: 'C' },
        { fromFieldId: 'C', toFieldId: 'D' },
        { fromFieldId: 'E', toFieldId: 'F' },
      ];
      const expectedResult: IGraphItem[] = [
        { fromFieldId: 'A', toFieldId: 'B' },
        { fromFieldId: 'B', toFieldId: 'C' },
        { fromFieldId: 'C', toFieldId: 'D' },
      ];
      expect(pruneGraph('A', graph)).toEqual(expectedResult);
    });

    test('returns an empty array for a graph with unrelated node', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: 'B', toFieldId: 'C' },
        { fromFieldId: 'C', toFieldId: 'D' },
      ];
      expect(pruneGraph('A', graph)).toEqual([]);
    });
  });
});
