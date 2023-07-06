import * as React from 'react';
import type { SVGProps } from 'react';
const MapPinOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="M5.43 5.43A8.06 8.06 0 0 0 4 10c0 6 8 12 8 12a29.944 29.944 0 0 0 5-5M19.18 13.52A8.66 8.66 0 0 0 20 10a8 8 0 0 0-8-8 7.88 7.88 0 0 0-3.52.82"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9.13 9.13a3 3 0 0 0 3.74 3.74M14.9 9.25a3 3 0 0 0-2.15-2.16M2 2l20 20"
    />
  </svg>
);
export default MapPinOff;
