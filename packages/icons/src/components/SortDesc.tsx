import * as React from 'react';
import type { SVGProps } from 'react';
const SortDesc = (props: SVGProps<SVGSVGElement>) => (
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
      d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4"
    />
  </svg>
);
export default SortDesc;
