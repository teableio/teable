import * as React from 'react';
import type { SVGProps } from 'react';

/**
 * Cuppy Loading Animation
 * Animated version of Cuppy with floating, blinking, steam, and sparkle effects
 *
 * Usage:
 * ```tsx
 * <CuppyLoader />
 * <CuppyLoader className="size-12" />
 * ```
 */
const CuppyLoader = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="72"
    height="72"
    viewBox="0 0 72 72"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ overflow: 'visible' }}
    {...props}
  >
    <style>
      {`
        @keyframes cuppy-float-rock {
          0% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-4px) rotate(2deg); }
          100% { transform: translateY(0) rotate(-2deg); }
        }

        @keyframes cuppy-shadow-scale {
          0% { transform: scale(1); opacity: 0.15; }
          50% { transform: scale(0.8); opacity: 0.08; }
          100% { transform: scale(1); opacity: 0.15; }
        }

        @keyframes cuppy-blink {
          0%, 45%, 55%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.1); }
        }

        @keyframes cuppy-steam-rise {
          0% { opacity: 0; transform: translateY(3px); }
          20% { opacity: 1; }
          80% { opacity: 0.3; }
          100% { opacity: 0; transform: translateY(-6px); }
        }

        .cuppy-group {
          transform-origin: 34px 58px;
          animation: cuppy-float-rock 3s ease-in-out infinite;
        }

        .cuppy-shadow {
          transform-origin: center;
          transform-box: fill-box;
          animation: cuppy-shadow-scale 3s ease-in-out infinite;
        }

        .cuppy-eye {
          transform-origin: center;
          transform-box: fill-box;
          animation: cuppy-blink 4s infinite;
        }
        .cuppy-eye.left { animation-delay: 0s; }
        .cuppy-eye.right { animation-delay: 0.1s; }

        .cuppy-steam {
          animation: cuppy-steam-rise 2.5s ease-in-out infinite;
        }
        .cuppy-steam.steam-1 { animation-delay: 0s; }
        .cuppy-steam.steam-2 { animation-delay: 0.8s; }

      `}
    </style>

    {/* Shadow */}
    <ellipse className="cuppy-shadow" cx="34.875" cy="63" rx="18" ry="2.25" fill="currentColor" />

    {/* Cup Group - animated */}
    <g className="cuppy-group">
      {/* Cup body with handle */}
      <path
        d="M48.375 23.6245C52.1028 23.6245 55.1248 26.6468 55.125 30.3745V30.52C56.4319 30.4717 57.7356 30.4516 59.0361 30.4604C61.9167 30.4973 64.6195 33.1521 64.6289 36.2437C64.6328 36.3496 64.6362 36.456 64.6396 36.562C64.6717 37.6991 64.5495 38.8486 64.2734 39.9595C62.994 45.4883 57.5891 49.5572 52.334 49.3735C52.0823 49.3698 51.8328 49.3566 51.585 49.3364C48.1177 54.2018 42.4296 57.3745 36 57.3745H31.5C20.9376 57.3745 12.375 48.812 12.375 38.2495V30.3745C12.3752 26.6468 15.3972 23.6245 19.125 23.6245H48.375ZM19.125 28.1245C17.8825 28.1245 16.8752 29.132 16.875 30.3745V38.2495C16.875 46.3267 23.4228 52.8745 31.5 52.8745H36C44.0772 52.8745 50.625 46.3267 50.625 38.2495V30.3745C50.6248 29.132 49.6175 28.1245 48.375 28.1245H19.125ZM55.125 38.2495C55.125 41.3096 54.4047 44.2013 53.127 46.7661C56.6721 45.2523 59.083 42.2166 59.9062 38.8745C60.0931 38.1214 60.2037 37.348 60.2354 36.562C60.2388 36.456 60.2422 36.3496 60.2461 36.2437C60.3354 35.3479 59.7357 34.3135 58.6445 33.9897C57.4687 33.7335 56.2956 33.4512 55.125 33.146V38.2495Z"
        fill="currentColor"
      />

      {/* Left Eye */}
      <ellipse
        className="cuppy-eye left"
        cx="27"
        cy="38.25"
        rx="3.375"
        ry="3.375"
        fill="currentColor"
      />

      {/* Right Eye */}
      <ellipse
        className="cuppy-eye right"
        cx="40.5"
        cy="38.25"
        rx="3.375"
        ry="3.375"
        fill="currentColor"
      />

      {/* Steam 1 */}
      <path
        className="cuppy-steam steam-1"
        d="M29.2246 9.44482C29.4159 9.46108 29.587 9.53302 29.7129 9.65771C29.8386 9.78243 29.9127 9.95305 29.9307 10.144C29.9484 10.3351 29.908 10.5319 29.8486 10.7183C29.7892 10.9112 29.7434 11.0921 29.7051 11.2642C29.5033 12.0635 29.5091 12.7152 29.6592 13.0444C29.799 13.368 29.9519 13.6652 30.2266 14.4663C30.4783 15.2127 30.8465 16.5425 30.4521 17.9067C30.0622 19.2646 29.1233 20.1006 28.2197 20.5698C28.0195 20.6714 27.8152 20.7579 27.5986 20.8433C27.4126 20.9042 27.2168 20.9454 27.0254 20.9292C26.834 20.9129 26.663 20.8411 26.5371 20.7163C26.4114 20.5915 26.3372 20.421 26.3193 20.23C26.3017 20.0389 26.342 19.8421 26.4014 19.6558C26.4606 19.463 26.5048 19.2831 26.543 19.1108C26.7416 18.3126 26.7188 17.6747 26.5596 17.3608C26.4142 17.0513 26.2458 16.7256 25.9609 15.9009C25.6969 15.1315 25.3524 13.7598 25.7793 12.4155C26.1973 11.0803 27.129 10.2693 28.0322 9.80225C28.2311 9.70284 28.4354 9.61548 28.6514 9.53076C28.8374 9.46983 29.0333 9.42861 29.2246 9.44482Z"
        fill="currentColor"
      />

      {/* Steam 2 */}
      <path
        className="cuppy-steam steam-2"
        d="M41.0439 4.9165C41.2408 4.9306 41.419 5.00653 41.5498 5.13721C41.6805 5.26792 41.7563 5.4463 41.7705 5.64307C41.7846 5.84 41.7352 6.03873 41.6592 6.22119C41.5656 6.44724 41.4886 6.65949 41.4209 6.86377C41.0813 7.81496 40.9702 8.64432 41.0879 9.17041C41.1927 9.69082 41.4057 10.1847 41.748 11.1753C42.0667 12.1101 42.5055 13.6438 42.0771 15.2153C41.6551 16.7797 40.5996 17.7885 39.5605 18.4067C39.3312 18.5401 39.097 18.6589 38.8467 18.7769C38.6642 18.853 38.4656 18.9023 38.2686 18.8882C38.0717 18.8741 37.8935 18.7982 37.7627 18.6675C37.632 18.5367 37.5561 18.3575 37.542 18.1606C37.5281 17.964 37.5773 17.7657 37.6533 17.5835C37.7468 17.3574 37.822 17.1458 37.8896 16.9409C38.2259 15.9906 38.3179 15.174 38.1865 14.6626C38.0714 14.1559 37.8388 13.6347 37.4863 12.6206C37.155 11.6628 36.744 10.0842 37.21 8.53369C37.6648 6.99381 38.7142 6.01196 39.7529 5.396C39.9808 5.26497 40.2161 5.14511 40.4658 5.02783C40.6483 4.95173 40.847 4.90239 41.0439 4.9165Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

export default CuppyLoader;
