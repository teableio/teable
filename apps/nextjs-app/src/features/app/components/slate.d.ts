import type { BaseElement } from 'slate';

declare module 'slate' {
  export interface BaseElement {
    type: string;
  }
}
