import * as React from 'react';
import type { SVGProps } from 'react';
const Pipette = (props: SVGProps<SVGSVGElement>) => (
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
      d="m2 22 1-1h3l9-9M3 21v-3l9-9"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m15 6 3.4-3.4a2.121 2.121 0 1 1 3 3L18 9l.4.4a2.122 2.122 0 0 1-3 3l-3.8-3.8a2.121 2.121 0 1 1 3-3l.4.4Z"
    />
  </svg>
);
export default Pipette;
