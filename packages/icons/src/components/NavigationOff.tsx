import * as React from 'react';
import type { SVGProps } from 'react';
const NavigationOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="M8.43 8.43 3 11l8 2 2 8 2.57-5.43M17.39 11.73 22 2l-9.73 4.61M2 2l20 20"
    />
  </svg>
);
export default NavigationOff;
