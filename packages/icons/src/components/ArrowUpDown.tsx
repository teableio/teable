import * as React from 'react';
import type { SVGProps } from 'react';
const ArrowUpDown = (props: SVGProps<SVGSVGElement>) => (
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
      d="m11 17-4 4-4-4M7 21V9M21 7l-4-4-4 4M17 15V3"
    />
  </svg>
);
export default ArrowUpDown;
