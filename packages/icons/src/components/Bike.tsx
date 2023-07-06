import * as React from 'react';
import type { SVGProps } from 'react';
const Bike = (props: SVGProps<SVGSVGElement>) => (
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
      d="M5.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM18.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12 17.5V14l-3-3 4-3 2 3h2m-2-5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
    />
  </svg>
);
export default Bike;
