import { useTranslation } from 'next-i18next';
import Image from 'next/image';
import type { FC } from 'react';

type Props = {
  children?: never;
};

export const HeroBlock: FC<Props> = () => {
  const { t } = useTranslation(['home', 'common']);

  return (
    <section className="body-font text-gray-600">
      <div className="container mx-auto flex flex-col items-center py-24 px-5 md:flex-row">
        <div className="mb-16 flex flex-col items-center text-center md:mb-0 md:w-1/2 md:items-start md:pr-16 md:text-left lg:grow lg:pr-24">
          <h1 className="title-font mb-4 text-3xl font-medium text-gray-900 sm:text-4xl">
            Before they sold out&nbsp;
            <br className="hidden lg:inline-block" />
            readymade gluten
          </h1>
          <p className="mb-8 leading-relaxed">
            Copper mug try-hard pitchfork pour-over freegan heirloom neutra air
            plant cold-pressed tacos poke beard tote bag. Heirloom echo park
            mlkshk tote bag selvage hot chicken authentic tumeric truffaut
            hexagon try-hard chambray.
          </p>
          <div className="flex justify-center">
            <button className="inline-flex rounded border-0 bg-indigo-500 py-2 px-6 text-lg text-white hover:bg-indigo-600 focus:outline-none">
              Button
            </button>
            <button className="ml-4 inline-flex rounded border-0 bg-gray-100 py-2 px-6 text-lg text-gray-700 hover:bg-gray-200 focus:outline-none">
              Button
            </button>
          </div>
        </div>
        <div className="w-5/6 md:w-1/2 lg:w-full lg:max-w-lg">
          <Image
            width={720}
            height={600}
            loading={'eager'}
            src={'/assets/annie-spratt-unsplash.jpg'}
            alt={'tailwind-ui-logo'}
            className="rounded object-cover object-center"
          />
        </div>
      </div>
    </section>
  );
};
