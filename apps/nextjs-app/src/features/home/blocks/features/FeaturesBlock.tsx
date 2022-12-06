import type { FC } from 'react';

type Props = {
  children?: never;
};

const lorem =
  'Lorem ipsum, dolor sit amet consectetur adipisicing elit. Maiores impedit perferendis suscipit eaque, iste dolor cupiditate blanditiis ratione.';

const features = [
  {
    name: 'Competitive exchange rates',
    description: lorem,
  },
  {
    name: 'No hidden fees',
    description: lorem,
  },
  {
    name: 'Transfers are instant',
    description: lorem,
  },
  {
    name: 'Mobile notifications',
    description: lorem,
  },
];

export const FeaturesBlock: FC<Props> = () => {
  return (
    <div className="bg-white py-12" style={{ width: '100%' }}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="lg:text-center">
          <h2 className="text-base font-semibold uppercase tracking-wide text-indigo-600">
            Transactions
          </h2>
          <p className="mt-2 text-3xl font-extrabold leading-8 tracking-tight text-gray-900 sm:text-4xl">
            A better way to send money
          </p>
          <p className="mt-4 max-w-2xl text-xl text-gray-500 lg:mx-auto">{lorem}</p>
        </div>

        <div className="mt-10">
          <dl className="space-y-10 md:grid md:grid-cols-2 md:gap-x-8 md:gap-y-10 md:space-y-0">
            {features.map((feature) => (
              <div key={feature.name} className="relative">
                <dt>
                  <p className="ml-16 text-lg font-medium leading-6 text-gray-900">
                    {feature.name}
                  </p>
                </dt>
                <dd className="mt-2 ml-16 text-base text-gray-500">{feature.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
};
