import * as React from 'react';
import type { SVGProps } from 'react';
const TimerOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="M10 2h4M4.6 11a8 8 0 0 0 1.7 8.7 8 8 0 0 0 8.7 1.7M7.4 7.4a8 8 0 0 1 10.3 1 8 8 0 0 1 .9 10.2M2 2l20 20M12 12v-2"
    />
  </svg>
);
export default TimerOff;
