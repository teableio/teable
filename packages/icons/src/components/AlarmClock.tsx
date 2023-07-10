import * as React from 'react';
import type { SVGProps } from 'react';
const AlarmClock = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v4l2 2M5 3 2 6M22 6l-3-3M6 19l-2 2M18 19l2 2"
    />
  </svg>
);
export default AlarmClock;
