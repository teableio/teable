import * as React from 'react';
import type { SVGProps } from 'react';
const Kwaipilot = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#FF4906" rx={4} />
    <path fill="#fff" d="M7 7h2v4l3-4h2.5l-3.5 4.5 4 5.5H12l-3-4.5V17H7z" />
  </svg>
);
export default Kwaipilot;
