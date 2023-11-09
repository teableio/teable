import { isEqual } from 'lodash';
import type { IRange } from '../../interface';
import { SelectionRegionType } from '../../interface';
import {
  flatRanges,
  isPointInsideRectangle,
  isRangeWithinRanges,
  mixRanges,
  serializedRanges,
} from '../../utils';

export class CombinedSelection {
  public type: SelectionRegionType;
  public ranges: IRange[];

  constructor(type: SelectionRegionType = SelectionRegionType.None, ranges: IRange[] = []) {
    this.type = type;
    this.ranges = ranges;
  }

  public get isColumnSelection() {
    return this.type === SelectionRegionType.Columns;
  }

  public get isRowSelection() {
    return this.type === SelectionRegionType.Rows;
  }

  public get isCellSelection() {
    return this.type === SelectionRegionType.Cells;
  }

  public get isNoneSelection() {
    return this.type === SelectionRegionType.None;
  }

  public reset(): CombinedSelection {
    return emptySelection;
  }

  public set(type: SelectionRegionType, ranges: IRange[]) {
    if (!Array.isArray(ranges)) {
      throw Error('Ranges of the selection should be an array type!');
    }

    if (type === SelectionRegionType.Cells && ranges.length < 2) {
      throw Error('Ranges of type cells should have a length greater than 2!');
    }

    if ([SelectionRegionType.Columns, SelectionRegionType.Rows].includes(type) && !ranges.length) {
      throw Error('Ranges of type columns or rows should have a length greater than 1!');
    }

    return new CombinedSelection(type, ranges);
  }

  public setRanges(ranges: IRange[]) {
    return new CombinedSelection(this.type, ranges);
  }

  private isOverlap(range1: IRange, range2: IRange): boolean {
    return !(range1[1] < range2[0] || range1[0] > range2[1]);
  }

  public expand(range: IRange): CombinedSelection {
    switch (this.type) {
      case SelectionRegionType.Rows:
      case SelectionRegionType.Columns: {
        let hasOverlap = false;
        const newRanges = this.ranges.map((existedRange) => {
          if (this.isOverlap(existedRange, range)) {
            hasOverlap = true;
            return [
              Math.min(existedRange[0], range[0]),
              Math.max(existedRange[1], range[1]),
            ] as IRange;
          }
          return existedRange;
        });

        if (!hasOverlap) {
          newRanges.push(range);
        }
        return new CombinedSelection(this.type, serializedRanges(newRanges));
      }
      case SelectionRegionType.Cells:
        return new CombinedSelection(this.type, [this.ranges[0], range]);
      default:
        return emptySelection;
    }
  }

  public merge(range: IRange): CombinedSelection {
    switch (this.type) {
      case SelectionRegionType.Rows:
      case SelectionRegionType.Columns: {
        const newRanges = mixRanges(this.ranges, range);
        return newRanges.length ? new CombinedSelection(this.type, newRanges) : emptySelection;
      }
      case SelectionRegionType.Cells:
        return new CombinedSelection(this.type, [this.ranges[0], range]);
      default:
        return emptySelection;
    }
  }

  public flatten(): number[] {
    const [start, end] = this.ranges;
    if (this.isCellSelection) return [...start, ...end];
    return flatRanges(this.ranges);
  }

  public serialize(): IRange[] {
    switch (this.type) {
      case SelectionRegionType.Rows:
      case SelectionRegionType.Columns:
        return serializedRanges(this.ranges);
      case SelectionRegionType.Cells: {
        const [start, end] = this.ranges;
        return [
          [Math.min(start[0], end[0]), Math.min(start[1], end[1])],
          [Math.max(start[0], end[0]), Math.max(start[1], end[1])],
        ];
      }
      default:
        return [];
    }
  }

  public includes(range?: IRange): boolean {
    if (range == null) return false;
    switch (this.type) {
      case SelectionRegionType.Rows:
      case SelectionRegionType.Columns:
        return isRangeWithinRanges(range, this.ranges);
      case SelectionRegionType.Cells:
        return isPointInsideRectangle(range, this.ranges[0], this.ranges[1]);
      default:
        return false;
    }
  }

  public equals(comparisonRanges: IRange[]): boolean {
    if (this.ranges.length !== comparisonRanges.length) return false;
    return isEqual(this.ranges, comparisonRanges);
  }
}

export const emptySelection = new CombinedSelection(SelectionRegionType.None, []);
