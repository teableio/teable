import * as React from 'react';
import type { SVGProps } from 'react';
const Sigma = (props: SVGProps<SVGSVGElement>) => (
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
      d="M18 7V4H6l6 8-6 8h12v-3"
    />
  </svg>
);
export default Sigma;
