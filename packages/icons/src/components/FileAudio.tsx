import * as React from 'react';
import type { SVGProps } from 'react';
const FileAudio = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__file-audio)">
      <path
        fill="#00BECA"
        fillRule="evenodd"
        d="M2.88 0A2.88 2.88 0 0 0 0 2.88v18.24A2.88 2.88 0 0 0 2.88 24h18.24A2.88 2.88 0 0 0 24 21.12V2.88A2.88 2.88 0 0 0 21.12 0zm14.037 6.01a.8.8 0 0 1 .67.21c.178.17.268.412.25.655l-.732 7.75-.002.022q-.011.142-.018.283a2.008 2.008 0 1 1-1.416-2.039l.351-3.824-5.194.763-.552 5.98q-.014.147-.02.292a2.008 2.008 0 1 1-1.431-2.034l.582-6.334a.8.8 0 0 1 .683-.72z"
        clipRule="evenodd"
      />
    </g>
    <defs>
      <clipPath id="prefix__file-audio">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default FileAudio;
