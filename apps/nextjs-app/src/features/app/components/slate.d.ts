// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { BaseElement } from 'slate';

declare module 'slate' {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  export interface BaseElement {
    type: string;
  }
}
