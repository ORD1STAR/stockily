/// <reference lib="dom" />
import { render, screen } from '@testing-library/react';
import { isChunkLoadError, RouteErrorBoundary } from './RouteErrorBoundary';

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    // React logs caught errors; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a way out instead of a blank page, with the technical detail', () => {
    render(
      <RouteErrorBoundary>
        <Boom message="Cannot read properties of undefined (reading 'x')" />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: /recharger la page/i })).toBeTruthy();
    expect(screen.getByText(/Cannot read properties of undefined/)).toBeTruthy();
  });

  it('renders its children when nothing fails', () => {
    render(
      <RouteErrorBoundary>
        <p>contenu</p>
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('contenu')).toBeTruthy();
  });

  it('recognises the stale-deploy errors of every browser', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/assets/StockPage-abc.js'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
