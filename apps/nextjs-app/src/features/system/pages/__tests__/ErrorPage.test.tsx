import { ErrorPage } from '@/features/system/pages';
import { render, screen } from '@/test-utils';

describe('errorPage test', () => {
  it('should contain error passed status code', async () => {
    render(<ErrorPage statusCode={500} />);
    expect(screen.getByTestId('error-status-code')).toHaveTextContent('500');
  });
});
