import * as React from 'react';
import type { SVGProps } from 'react';
const ChevronsLeft = (props: SVGProps<SVGSVGElement>) => (
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
      d="m11 17-5-5 5-5M18 17l-5-5 5-5"
    />
  </svg>
);
export default ChevronsLeft;
