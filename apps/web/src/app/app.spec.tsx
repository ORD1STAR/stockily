import { render, screen } from '@testing-library/react';
import App from './app';

describe('App', () => {
  it('redirects an unauthenticated visitor to the login page', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: /se connecter/i })).toBeTruthy();
  });
});
