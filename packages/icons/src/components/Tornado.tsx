import * as React from 'react';
import type { SVGProps } from 'react';
const Tornado = (props: SVGProps<SVGSVGElement>) => (
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
      d="M21 4H3M18 8H6M19 12H9M16 16h-6M11 20H9"
    />
  </svg>
);
export default Tornado;
