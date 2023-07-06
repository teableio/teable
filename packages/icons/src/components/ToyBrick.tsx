import * as React from 'react';
import type { SVGProps } from 'react';
const ToyBrick = (props: SVGProps<SVGSVGElement>) => (
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
      d="M20 8H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1ZM10 8V5c0-.6-.4-1-1-1H6a1 1 0 0 0-1 1v3M19 8V5c0-.6-.4-1-1-1h-3a1 1 0 0 0-1 1v3"
    />
  </svg>
);
export default ToyBrick;
