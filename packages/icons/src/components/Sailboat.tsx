import * as React from 'react';
import type { SVGProps } from 'react';
const Sailboat = (props: SVGProps<SVGSVGElement>) => (
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
      d="M22 18H2a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4ZM21 14 10 2 3 14h18ZM10 2v16"
    />
  </svg>
);
export default Sailboat;
