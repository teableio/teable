import * as React from 'react';
import type { SVGProps } from 'react';
const Slice = (props: SVGProps<SVGSVGElement>) => (
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
      d="m8 14-6 6h9v-3"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M18.37 3.63 8 14l3 3L21.37 6.63a2.121 2.121 0 0 0-3-3Z"
    />
  </svg>
);
export default Slice;
