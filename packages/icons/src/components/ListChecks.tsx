import * as React from 'react';
import type { SVGProps } from 'react';
const ListChecks = (props: SVGProps<SVGSVGElement>) => (
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
      d="M10 6h11m-11 6h11m-11 6h11M3 6l1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2"
    />
  </svg>
);
export default ListChecks;
