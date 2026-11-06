/// <reference lib="dom" />
import { render, screen } from '@testing-library/react';
import App from './app';

describe('App', () => {
  afterEach(() => window.history.pushState({}, '', '/'));

  it('shows the public site at / with account actions for a visitor', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: /plus de ruptures surprises/i })).toBeTruthy();
    expect((await screen.findAllByRole('link', { name: /se connecter/i })).length).toBeGreaterThan(0);
    // The logged-in header destinations must not appear for a visitor.
    expect(screen.queryByText('Abonnement & compte')).toBeNull();
  });

  it('redirects an unauthenticated visitor from the app to the login page', async () => {
    window.history.pushState({}, '', '/dashboard');
    render(<App />);
    expect(await screen.findByRole('button', { name: /se connecter/i })).toBeTruthy();
  });
});
