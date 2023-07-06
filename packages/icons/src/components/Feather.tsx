import * as React from 'react';
import type { SVGProps } from 'react';
const Feather = (props: SVGProps<SVGSVGElement>) => (
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
      d="M20.24 12.24a6.003 6.003 0 0 0-8.49-8.49L5 10.5V19h8.5l6.74-6.76ZM16 8 2 22M17.5 15H9"
    />
  </svg>
);
export default Feather;
