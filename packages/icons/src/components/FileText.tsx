import * as React from 'react';
import type { SVGProps } from 'react';
const FileText = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__a)">
      <path
        fill="#6F8BB5"
        fillRule="evenodd"
        d="M2.88 0A2.88 2.88 0 0 0 0 2.88v18.24A2.88 2.88 0 0 0 2.88 24h18.24A2.88 2.88 0 0 0 24 21.12V2.88A2.88 2.88 0 0 0 21.12 0zm12.684 7.48a2 2 0 0 0-.41-.04h-6.27q-.21 0-.408.04a.48.48 0 0 0-.317.224q-.12.171-.119.594 0 .423.119.607.119.172.317.225.198.04.409.04h2.151v6.52q0 .25.04.488.04.225.25.37.212.132.687.132.489 0 .687-.132a.56.56 0 0 0 .25-.37 2 2 0 0 0 .053-.475V9.17h2.125q.224 0 .423-.04a.48.48 0 0 0 .317-.224Q16 8.721 16 8.311q0-.435-.132-.607a.48.48 0 0 0-.304-.224"
        clipRule="evenodd"
      />
    </g>
    <defs>
      <clipPath id="prefix__a">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default FileText;
