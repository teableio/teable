import * as React from 'react';
import type { SVGProps } from 'react';
const RockingChair = (props: SVGProps<SVGSVGElement>) => (
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
      d="m3.5 2 3 10.5H18M9.5 12.5l-4 7.5M15 12.5l3.5 7.5M2.75 18a13 13 0 0 0 18.5 0"
    />
  </svg>
);
export default RockingChair;
