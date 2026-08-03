import type { FC } from 'react';
import { useEffect, useState } from 'react';

type Props = {
  apiUrl: string;
  children?: never;
};

export const AsyncMessage: FC<Props> = (props) => {
  const [msg, setMsg] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(props.apiUrl)
      .then((res) => res.text())
      .then((data) => {
        setMsg(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      });
  }, [props.apiUrl]);

  if (error) {
    return <span>Error: {error}</span>;
  }
  if (isLoading) {
    return <span>Loading</span>;
  }

  return <span>{msg}</span>;
};
