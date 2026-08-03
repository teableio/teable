import * as React from 'react';
import type { SVGProps } from 'react';
const FileScript = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__file-script)">
      <path
        fill="#121219"
        fillRule="evenodd"
        d="M2.88 0A2.88 2.88 0 0 0 0 2.88v18.24A2.88 2.88 0 0 0 2.88 24h18.24A2.88 2.88 0 0 0 24 21.12V2.88A2.88 2.88 0 0 0 21.12 0zm16.475 13.054c.287-.284.445-.667.445-1.07 0-.401-.16-.787-.447-1.073l-3.027-3.028a1.513 1.513 0 1 0-2.14 2.141l1.958 1.959-1.956 1.958a1.514 1.514 0 1 0 2.14 2.14zM7.671 16.08c.281.287.667.445 1.069.445s.785-.158 1.071-.442a1.513 1.513 0 0 0 0-2.14l-1.958-1.96 1.958-1.96a1.513 1.513 0 1 0-2.14-2.14l-3.03 3.03a1.515 1.515 0 0 0 .003 2.14z"
        clipRule="evenodd"
      />
    </g>
    <defs>
      <clipPath id="prefix__file-script">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default FileScript;
