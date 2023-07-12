import * as React from 'react';
import type { SVGProps } from 'react';
const EggOff = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M6.399 6.399C5.362 8.157 4.65 10.19 4.5 12c-.37 4.43 1.27 9.95 7.5 10 3.256-.026 5.259-1.547 6.375-3.625M19.532 13.875c.031-.625.02-1.251-.032-1.875-.36-4.34-3.95-9.96-7.5-10-1.04.012-2.082.502-3.046 1.297M2 2l20 20"
    />
  </svg>
);
export default EggOff;
