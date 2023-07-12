import * as React from 'react';
import type { SVGProps } from 'react';
const Framer = (props: SVGProps<SVGSVGElement>) => (
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
      d="M5 16V9h14V2H5l14 14h-7m-7 0 7 7v-7m-7 0h7"
    />
  </svg>
);
export default Framer;
