import withEnv from '@/lib/withEnv';
import { getServerSideProps as getServerSidePropsBase } from './table/[tableId]/index';

export const getServerSideProps = withEnv(getServerSidePropsBase);
export { default } from './table/[tableId]/index';
