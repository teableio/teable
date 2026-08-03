import * as React from 'react';
import type { SVGProps } from 'react';
const Flame = (props: SVGProps<SVGSVGElement>) => (
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
      d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7.001 7.001 0 0 1-11.95 4.95A7 7 0 0 1 5 15c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5"
    />
  </svg>
);
export default Flame;
