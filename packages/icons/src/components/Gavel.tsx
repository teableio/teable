import * as React from 'react';
import type { SVGProps } from 'react';
const Gavel = (props: SVGProps<SVGSVGElement>) => (
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
      d="m14 13-7.5 7.5a2.118 2.118 0 0 1-3.46-.688A2.12 2.12 0 0 1 3.5 17.5L11 10M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8"
    />
  </svg>
);
export default Gavel;
