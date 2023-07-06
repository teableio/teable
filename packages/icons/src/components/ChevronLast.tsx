import * as React from 'react';
import type { SVGProps } from 'react';
const ChevronLast = (props: SVGProps<SVGSVGElement>) => (
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
      d="m7 18 6-6-6-6M17 6v12"
    />
  </svg>
);
export default ChevronLast;
