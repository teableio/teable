import * as React from 'react';
import type { SVGProps } from 'react';
const ChevronsDown = (props: SVGProps<SVGSVGElement>) => (
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
      d="m7 13 5 5 5-5M7 6l5 5 5-5"
    />
  </svg>
);
export default ChevronsDown;
