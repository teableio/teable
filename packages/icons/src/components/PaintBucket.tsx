import * as React from 'react';
import type { SVGProps } from 'react';
const PaintBucket = (props: SVGProps<SVGSVGElement>) => (
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
      d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0zM5 2l5 5M2 13h15M22 20a2 2 0 0 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4"
    />
  </svg>
);
export default PaintBucket;
