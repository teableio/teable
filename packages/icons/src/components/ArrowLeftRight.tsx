import * as React from 'react';
import type { SVGProps } from 'react';
const ArrowLeftRight = (props: SVGProps<SVGSVGElement>) => (
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
      d="m17 11 4-4-4-4M21 7H9M7 21l-4-4 4-4M15 17H3"
    />
  </svg>
);
export default ArrowLeftRight;
