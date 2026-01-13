import { useTheme } from '@teable/next-themes';
import { Button } from '@teable/ui-lib/shadcn';
import Head from 'next/head';
import Image from 'next/image';
import type { FC } from 'react';

export interface IButtonConfig {
  label: string;
  href: string;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive';
}

export interface IIllustrationPageProps {
  /** Light theme image path */
  imageLightSrc: string;
  /** Dark theme image path */
  imageDarkSrc: string;
  /** Image alt text */
  imageAlt?: string;
  /** Page title (also used for document title) */
  title: string;
  /** Page description */
  description?: string;
  /** Button config */
  button: IButtonConfig;
}

export const IllustrationPage: FC<IIllustrationPageProps> = ({
  imageLightSrc,
  imageDarkSrc,
  imageAlt = 'Illustration',
  title,
  description,
  button,
}) => {
  const { resolvedTheme } = useTheme();

  const imageSrc = resolvedTheme === 'dark' ? imageDarkSrc : imageLightSrc;

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="flex h-screen flex-col items-center justify-center px-4 text-center">
        <Image src={imageSrc} alt={imageAlt} width={240} height={240} priority />
        <div className="mb-6 mt-4 flex flex-col items-center justify-center gap-2">
          <h1 data-testid="not-found-title" className="text-3xl font-semibold md:text-2xl">
            {title}
          </h1>
          {description && (
            <p className="max-w-md whitespace-pre-line text-base text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <Button asChild variant={button.variant ?? 'default'}>
          <a href={button.href}>{button.label}</a>
        </Button>
      </div>
    </>
  );
};
