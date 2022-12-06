import { NotFoundPage } from '@/features/system/pages';
import { render, screen } from '@/test-utils';

describe('notFoundPage test', () => {
  it('should contain passed title', async () => {
    render(<NotFoundPage title={'404 - Not found'} />);
    expect(screen.getByTestId('not-found-title')).toHaveTextContent('404 - Not found');
  });
});
