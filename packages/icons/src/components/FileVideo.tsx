import * as React from 'react';
import type { SVGProps } from 'react';
const FileVideo = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__file-video)">
      <path
        fill="#844FDA"
        fillRule="evenodd"
        d="M2.88 0A2.88 2.88 0 0 0 0 2.88v18.24A2.88 2.88 0 0 0 2.88 24h18.24A2.88 2.88 0 0 0 24 21.12V2.88A2.88 2.88 0 0 0 21.12 0zm4.315 17.88c.239.12.358.12.596.12s.357 0 .595-.12l8.337-4.775c.357-.24.595-.598.595-1.075 0-.478-.238-.836-.595-1.075L8.386 6.18a1.08 1.08 0 0 0-1.19 0c-.358.239-.596.597-.596 1.075v9.552c0 .478.238.836.595 1.075m6.55-5.85-4.763 2.746V9.284z"
        clipRule="evenodd"
      />
    </g>
    <defs>
      <clipPath id="prefix__file-video">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default FileVideo;
