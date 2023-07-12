import * as React from 'react';
import type { SVGProps } from 'react';
const VibrateOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="m2 8 2 2-2 2 2 2-2 2M22 8l-2 2 2 2-2 2 2 2M8 8v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2M16 10.34V6c0-.55-.45-1-1-1h-4.34M2 2l20 20"
    />
  </svg>
);
export default VibrateOff;
