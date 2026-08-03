import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
type Props = {
  /** Add HomeRoute props here */
};

export default function DemoRoute(_props: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return <></>;
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  // Preserve query parameters when redirecting to /space
  const queryString = context.req.url?.split('?')[1];
  const destination = queryString ? `/space?${queryString}` : '/space';
  return {
    redirect: {
      destination,
      permanent: false,
    },
  };
};
