import * as React from 'react';
import type { SVGProps } from 'react';
const Megaphone = (props: SVGProps<SVGSVGElement>) => (
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
      d="m3 11 18-5v12L3 14v-3ZM11.6 16.8a3.009 3.009 0 0 1-5.8-1.6"
    />
  </svg>
);
export default Megaphone;
