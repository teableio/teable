import * as React from 'react';
import type { SVGProps } from 'react';
const AlarmClockOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="M6.87 6.87a8 8 0 1 0 11.26 11.26M19.9 14.25a8 8 0 0 0-9.15-9.15M22 6l-3-3M6 19l-2 2M2 2l20 20M4 4 2 6"
    />
  </svg>
);
export default AlarmClockOff;
