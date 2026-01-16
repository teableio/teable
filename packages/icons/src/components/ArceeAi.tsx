import * as React from 'react';
import type { SVGProps } from 'react';
const ArceeAi = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#3B82F6" rx={4} />
    <path fill="#fff" d="M8 17 12 7l4 10h-2l-.75-2h-2.5L10 17zm3.25-4h1.5L12 11z" />
  </svg>
);
export default ArceeAi;
