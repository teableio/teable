import * as React from 'react';
import type { SVGProps } from 'react';
const BluetoothOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="m17 17-5 5V12l-5 5M2 2l20 20M14.5 9.5 17 7l-5-5v4.5"
    />
  </svg>
);
export default BluetoothOff;
