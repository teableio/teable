type IFilterOptional<T> = Pick<
  T,
  Exclude<
    {
      [K in keyof T]: T extends Record<K, T[K]> ? K : never;
    }[keyof T],
    undefined
  >
>;

type IFilterNotOptional<T> = Pick<
  T,
  Exclude<
    {
      [K in keyof T]: T extends Record<K, T[K]> ? never : K;
    }[keyof T],
    undefined
  >
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IPartialEither<T, K extends keyof any> = {
  [P in Exclude<keyof IFilterOptional<T>, K>]-?: T[P];
} & { [P in Exclude<keyof IFilterNotOptional<T>, K>]?: T[P] } & {
  [P in Extract<keyof T, K>]?: undefined;
};

type IObject = {
  [name: string]: unknown;
};

export type IEitherOr<O extends IObject, L extends string, R extends string> = (
  | IPartialEither<Pick<O, L | R>, L>
  | IPartialEither<Pick<O, L | R>, R>
) &
  Omit<O, L | R>;
