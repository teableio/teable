import * as React from 'react';
import type { SVGProps } from 'react';
const Shovel = (props: SVGProps<SVGSVGElement>) => (
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
      d="M2 22v-5l5-5 5 5-5 5H2ZM9.5 14.5 16 8M17 2l5 5-.5.5a3.53 3.53 0 0 1-5 0 3.53 3.53 0 0 1 0-5L17 2Z"
    />
  </svg>
);
export default Shovel;
