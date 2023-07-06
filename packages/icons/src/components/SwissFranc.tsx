import * as React from 'react';
import type { SVGProps } from 'react';
const SwissFranc = (props: SVGProps<SVGSVGElement>) => (
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
      d="M10 21V3h8M6 16h9M10 9.5h7"
    />
  </svg>
);
export default SwissFranc;
