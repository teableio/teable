import * as React from 'react';
import type { SVGProps } from 'react';
const AlignCenterVertical = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 2v20M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4M16 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1"
    />
  </svg>
);
export default AlignCenterVertical;
