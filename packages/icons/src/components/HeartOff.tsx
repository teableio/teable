import * as React from 'react';
import type { SVGProps } from 'react';
const HeartOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="M4.12 4.107c-.19.146-.37.304-.538.473C1.46 6.7 1.33 10.28 4 13l8 8 4.5-4.5M19.328 13.672 20 13c2.67-2.72 2.54-6.3.42-8.42a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-2.386-1.393M2 2l20 20"
    />
  </svg>
);
export default HeartOff;
