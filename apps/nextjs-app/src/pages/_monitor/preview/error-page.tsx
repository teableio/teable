import { ErrorPage } from '@/features/system/pages';

const exampleError = new Error('ErrorPage example error');

export default function ErrorPageRoute() {
  return (
    <ErrorPage
      statusCode={500}
      message={'ErrorPage preview'}
      errorId={'xxxxx-xxxxx-xxxxx-xxxxx'}
      error={exampleError}
    />
  );
}
