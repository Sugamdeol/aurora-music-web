import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../src/components/AppShell';
import { usePlaybackStore } from '../src/store/playback';

afterEach(cleanup);

it('keeps five phone destinations and makes remaining screens reachable in More', () => {
  usePlaybackStore.setState({ currentTrack: null, fullPlayerOpen: false, activeSheet: null });
  const { container } = render(<MemoryRouter><AppShell /></MemoryRouter>);
  const navigation = container.querySelector('.bottom-nav')!;
  expect(within(navigation as HTMLElement).getAllByRole('link')).toHaveLength(4);
  fireEvent.click(within(navigation as HTMLElement).getByRole('button', { name: 'More navigation' }));
  const sheet = screen.getByRole('dialog', { name: 'More navigation' });
  expect(within(sheet).getByRole('link', { name: 'AI Studio' })).toHaveAttribute('href', '/ai');
  expect(within(sheet).getByRole('link', { name: 'Together' })).toHaveAttribute('href', '/room');
  fireEvent.click(within(sheet).getByRole('link', { name: 'Settings' }));
  expect(screen.queryByRole('dialog', { name: 'More navigation' })).not.toBeInTheDocument();
});
