import * as React from 'react';
import type { SVGProps } from 'react';
const SortAsc = (props: SVGProps<SVGSVGElement>) => (
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
      d="M11 11h4M11 15h7M11 19h10M9 7 6 4 3 7M6 6v14"
    />
  </svg>
);
export default SortAsc;
