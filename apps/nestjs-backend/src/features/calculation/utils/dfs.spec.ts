import type { IGraphItem } from './dfs';
import { pruneGraph, getTopoOrders, topoOrderWithStart, hasCycle } from './dfs';

describe('Graph Processing Functions', () => {
  describe('getTopoOrders', () => {
    it('should return correct order for a DAG', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: '1', toFieldId: '2' },
        { fromFieldId: '2', toFieldId: '3' },
      ];
      const result = getTopoOrders(graph);
      expect(result).toEqual([
        { id: '1', dependencies: [] },
        { id: '2', dependencies: ['1'] },
        { id: '3', dependencies: ['2'] },
      ]);
    });

    it('should return correct order for a normal DAG', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: '1', toFieldId: '2' },
        { fromFieldId: '2', toFieldId: '3' },
      ];
      const result = getTopoOrders(graph);
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
      const result = getTopoOrders(graph);
      expect(result).toEqual([
        { id: '1', dependencies: [] },
        { id: '2', dependencies: ['1'] },
        { id: '3', dependencies: ['2', '1'] },
        { id: '4', dependencies: ['3'] },
      ]);
    });

    it('should handle a graph with multiple entry nodes', () => {
      const graph: IGraphItem[] = [
        { fromFieldId: '1', toFieldId: '3' },
        { fromFieldId: '2', toFieldId: '3' },
      ];
      const result = getTopoOrders(graph);

      expect(result).toEqual([
        { id: '1', dependencies: [] },
        { id: '2', dependencies: [] },
        { id: '3', dependencies: ['1', '2'] },
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
