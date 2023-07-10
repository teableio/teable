import * as React from 'react';
import type { SVGProps } from 'react';
const Stethoscope = (props: SVGProps<SVGSVGElement>) => (
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
      d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 1 0 12 0V4a2 2 0 0 0-2-2h-1a.213.213 0 0 0 .15.362.212.212 0 0 0 .15-.062"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 15v1a6 6 0 1 0 12 0v-4M20 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
    />
  </svg>
);
export default Stethoscope;
