import * as React from 'react';
import type { SVGProps } from 'react';
const Mic2 = (props: SVGProps<SVGSVGElement>) => (
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
      d="m12 8-9.04 9.06a2.82 2.82 0 1 0 3.98 3.98L16 12"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M17 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
    />
  </svg>
);
export default Mic2;
