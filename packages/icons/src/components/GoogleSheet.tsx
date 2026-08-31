import * as React from 'react';
import type { SVGProps } from 'react';
const GoogleSheet = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      fill="#188038"
      d="M14.5 1H6a1.5 1.5 0 0 0-1.5 1.5v19A1.5 1.5 0 0 0 6 23h12a1.5 1.5 0 0 0 1.5-1.5V6z"
    />
    <path fill="#34A853" d="M14.5 1v5h5z" />
    <g stroke="#fff" strokeWidth={1.2}>
      <rect x={8.1} y={11.6} width={7.8} height={5.8} rx={0.4} />
      <path d="M8.1 14.5h7.8M12 11.6v5.8" />
    </g>
  </svg>
);
export default GoogleSheet;
