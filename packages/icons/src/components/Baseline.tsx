import * as React from 'react';
import type { SVGProps } from 'react';
const Baseline = (props: SVGProps<SVGSVGElement>) => (
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
      d="M4 20h16M6 16l6-12 6 12M8 12h8"
    />
  </svg>
);
export default Baseline;
