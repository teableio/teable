import * as React from 'react';
import type { SVGProps } from 'react';
const Twitch = (props: SVGProps<SVGSVGElement>) => (
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
      d="M11 11V7m5 4V7m5-5H3v16h5v4l4-4h5l4-4V2Z"
    />
  </svg>
);
export default Twitch;
