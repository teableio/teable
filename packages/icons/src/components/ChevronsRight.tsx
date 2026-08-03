import * as React from 'react';
import type { SVGProps } from 'react';
const ChevronsRight = (props: SVGProps<SVGSVGElement>) => (
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
      d="m13 17 5-5-5-5M6 17l5-5-5-5"
    />
  </svg>
);
export default ChevronsRight;
