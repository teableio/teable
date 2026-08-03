import type { FC } from 'react';

type Props = {
  message: string;
  children?: never;
};

export const Message: FC<Props> = ({ message }) => <span>{message}</span>;
