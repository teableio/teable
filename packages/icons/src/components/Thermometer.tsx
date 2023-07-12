import * as React from 'react';
import type { SVGProps } from 'react';
const Thermometer = (props: SVGProps<SVGSVGElement>) => (
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
      d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z"
    />
  </svg>
);
export default Thermometer;
