import * as React from 'react';
import type { SVGProps } from 'react';
const ChefHat = (props: SVGProps<SVGSVGElement>) => (
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
      d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0c.441.445.797.967 1.05 1.54A4 4 0 0 1 18 13.87V21H6v-7.13ZM6 17h12"
    />
  </svg>
);
export default ChefHat;
