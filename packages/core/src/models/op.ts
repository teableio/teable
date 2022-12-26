/* eslint-disable @typescript-eslint/no-explicit-any */
// ot-type from https://github.com/ottypes/json0
export type IOTPath = (string | number)[];

export interface IOtOperation {
  p: IOTPath;
  na?: number;
  li?: any;
  ld?: any;
  lm?: number;
  oi?: any;
  od?: any;
  si?: string;
  sd?: string;
  t?: string;
  o?: any;
}
