import * as React from 'react';
import type { SVGProps } from 'react';
const BluetoothConnected = (props: SVGProps<SVGSVGElement>) => (
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
      d="m7 7 10 10-5 5V2l5 5L7 17M18 12h3M3 12h3"
    />
  </svg>
);
export default BluetoothConnected;
