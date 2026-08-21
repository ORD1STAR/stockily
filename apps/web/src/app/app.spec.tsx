import { render } from '@testing-library/react';

import App from './app';

describe('App', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<App />);
    expect(baseElement).toBeTruthy();
  });

  it('renders the Stockily heading', () => {
    const { getAllByText } = render(<App />);
    expect(getAllByText(/Stockily/i).length > 0).toBeTruthy();
  });
});
