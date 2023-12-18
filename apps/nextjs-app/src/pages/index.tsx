import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
type Props = {
  /** Add HomeRoute props here */
};

export default function DemoRoute(_props: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return <></>;
}

export const getServerSideProps: GetServerSideProps<Props> = async (_context) => {
  return {
    redirect: {
      destination: `/space`,
      permanent: false,
    },
  };
};
