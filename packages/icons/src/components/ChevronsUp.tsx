import * as React from 'react';
import type { SVGProps } from 'react';
const ChevronsUp = (props: SVGProps<SVGSVGElement>) => (
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
      d="m17 11-5-5-5 5M17 18l-5-5-5 5"
    />
  </svg>
);
export default ChevronsUp;
