import * as React from 'react';
import type { SVGProps } from 'react';
const Lamp = (props: SVGProps<SVGSVGElement>) => (
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
      d="M8 2h8l4 10H4L8 2ZM12 12v6M8 22v-2c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v2H8Z"
    />
  </svg>
);
export default Lamp;
