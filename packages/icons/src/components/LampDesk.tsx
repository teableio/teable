import * as React from 'react';
import type { SVGProps } from 'react';
const LampDesk = (props: SVGProps<SVGSVGElement>) => (
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
      d="m14 5-3 3 2 7 8-8-7-2Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m14 5-3 3-3-3 3-3 3 3Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9.5 6.5 4 12l3 6M3 22v-2c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v2H3Z"
    />
  </svg>
);
export default LampDesk;
