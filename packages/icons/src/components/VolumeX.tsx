import * as React from 'react';
import type { SVGProps } from 'react';
const VolumeX = (props: SVGProps<SVGSVGElement>) => (
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
      d="M11 5 6 9H2v6h4l5 4V5ZM22 9l-6 6M16 9l6 6"
    />
  </svg>
);
export default VolumeX;
