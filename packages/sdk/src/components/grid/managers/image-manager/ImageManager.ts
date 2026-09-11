import { throttle } from 'lodash';
import type { ICellItem, IRectangle } from '../../interface';

interface ILoadResult {
  img: HTMLImageElement | undefined;
  /** The browser could not load or decode `url`; stays set until the entry is evicted. */
  failed?: boolean;
  cancel: () => void;
  url: string;
  cells: number[];
}

export interface IGlobalImageManager {
  setWindow(newWindow: IRectangle, freezeCols: number): void;
  loadOrGetImage(url: string, col: number, row: number): HTMLImageElement | ImageBitmap | undefined;
  /** Whether loading `url` has failed, as opposed to still being in flight. */
  hasFailed(url: string): boolean;
  setCallback(imageLoaded: (locations: ICellItem[]) => void): void;
}

const imgPool: HTMLImageElement[] = [];

const rowShift = 1 << 16;

function packColRowToNumber(col: number, row: number) {
  return row * rowShift + col;
}

function unpackCol(packed: number): number {
  return packed % rowShift;
}

function unpackRow(packed: number, col: number): number {
  return (packed - col) / rowShift;
}

function unpackNumberToColRow(packed: number): [number, number] {
  const col = unpackCol(packed);
  const row = unpackRow(packed, col);
  return [col, row];
}

export class ImageManager implements IGlobalImageManager {
  private imageLoaded: (locations: ICellItem[]) => void = () => undefined;
  private loadedLocations: [number, number][] = [];

  private visibleWindow: IRectangle = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };

  private freezeColumnCount = 0;

  private isInWindow = (packed: number) => {
    const col = unpackCol(packed);
    const row = unpackRow(packed, col);
    const w = this.visibleWindow;
    if (col < this.freezeColumnCount && row >= w.y && row <= w.y + w.height) return true;
    return col >= w.x && col <= w.x + w.width && row >= w.y && row <= w.y + w.height;
  };

  private cache: Record<string, ILoadResult> = {};

  public setCallback(imageLoaded: (locations: ICellItem[]) => void) {
    this.imageLoaded = imageLoaded;
  }

  private sendLoaded = throttle(() => {
    this.imageLoaded(this.loadedLocations);
    this.loadedLocations = [];
  }, 20);

  private clearOutOfWindow = () => {
    const keys = Object.keys(this.cache);
    for (const key of keys) {
      const obj = this.cache[key];

      let keep = false;
      for (let j = 0; j < obj.cells.length; j++) {
        const packed = obj.cells[j];
        if (this.isInWindow(packed)) {
          keep = true;
          break;
        }
      }

      if (keep) {
        obj.cells = obj.cells.filter(this.isInWindow);
      } else {
        obj.cancel();
        delete this.cache[key];
      }
    }
  };

  public setWindow(newWindow: IRectangle, freezeColumnCount: number): void {
    if (
      this.visibleWindow.x === newWindow.x &&
      this.visibleWindow.y === newWindow.y &&
      this.visibleWindow.width === newWindow.width &&
      this.visibleWindow.height === newWindow.height &&
      this.freezeColumnCount === freezeColumnCount
    )
      return;
    this.visibleWindow = newWindow;
    this.freezeColumnCount = freezeColumnCount;
    this.clearOutOfWindow();
  }

  private loadImage(url: string, col: number, row: number, key: string) {
    let loaded = false;
    const img = imgPool.pop() ?? new Image();

    let canceled = false;
    const result: ILoadResult = {
      img: undefined,
      cells: [packColRowToNumber(col, row)],
      url,
      cancel: () => {
        if (canceled) return;
        canceled = true;
        if (imgPool.length < 12) {
          imgPool.unshift(img); // never retain more than 12
        } else if (!loaded) {
          img.src = '';
        }
      },
    };

    const loadPromise = new Promise<void>((resolve, reject) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), {
        once: true,
      });
    });
    // Cells are redrawn on both outcomes: a failure has to replace the loading
    // placeholder just like a loaded image does.
    const settle = (settled: (entry: ILoadResult) => void) => {
      const entry = this.cache[key];
      if (entry === undefined || canceled) return;
      settled(entry);
      for (const packed of entry.cells) {
        this.loadedLocations.push(unpackNumberToColRow(packed));
      }
      this.sendLoaded();
    };
    // use request animation time to avoid paying src set costs during draw calls
    requestAnimationFrame(async () => {
      try {
        img.src = url;
        await loadPromise;
        await img.decode();
        settle((entry) => {
          entry.img = img;
          loaded = true;
        });
      } catch {
        settle((entry) => {
          entry.failed = true;
        });
        result.cancel();
      }
    });
    this.cache[key] = result;
  }

  public hasFailed(url: string): boolean {
    return this.cache[url]?.failed === true;
  }

  public loadOrGetImage(
    url: string,
    col: number,
    row: number
  ): HTMLImageElement | ImageBitmap | undefined {
    const key = url;

    const current = this.cache[key];
    if (current !== undefined) {
      const packed = packColRowToNumber(col, row);
      if (!current.cells.includes(packed)) {
        current.cells.push(packed);
      }
      return current.img;
    } else {
      this.loadImage(url, col, row, key);
    }
    return undefined;
  }
}
