import * as React from 'react';
import type { SVGProps } from 'react';
const ShowerHead = (props: SVGProps<SVGSVGElement>) => (
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
      d="m4 4 2.5 2.5M13.5 6.5a4.95 4.95 0 0 0-7 7M15 5 5 15M14 17v.01M10 16v.01M13 13v.01M16 10v.01M11 20v.01M17 14v.01M20 11v.01"
    />
  </svg>
);
export default ShowerHead;
