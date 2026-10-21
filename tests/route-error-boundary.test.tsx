import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RouteErrorBoundary } from '../src/components/RouteErrorBoundary';

afterEach(cleanup);

it('shows a retry action instead of a blank screen when a route chunk fails', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  function BrokenRoute(): never { throw new Error('chunk load failed'); }
  render(<RouteErrorBoundary><BrokenRoute /></RouteErrorBoundary>);
  expect(screen.getByRole('alert')).toHaveTextContent('This page could not be opened.');
  expect(screen.getByRole('button', { name: 'Retry page' })).toBeInTheDocument();
  error.mockRestore();
});

it('retries the route after the user requests recovery', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let fail = true;
  function MaybeBrokenRoute() { if (fail) throw new Error('transient failure'); return <h1>Settings</h1>; }
  const view = render(<RouteErrorBoundary><MaybeBrokenRoute /></RouteErrorBoundary>);
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry page' }));
  expect(view.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  error.mockRestore();
});
