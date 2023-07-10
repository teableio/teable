import * as React from 'react';
import type { SVGProps } from 'react';
const Bed = (props: SVGProps<SVGSVGElement>) => (
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
      d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"
    />
  </svg>
);
export default Bed;
