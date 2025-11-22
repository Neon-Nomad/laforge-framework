import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommandPalette', () => {
  const noop = () => {};

  it('shows only commands allowed for the profile', () => {
    render(<CommandPalette profileId="auditor" isOpen onClose={noop} onNavigate={noop} />);

    expect(screen.getByRole('button', { name: /Open Audit Stream/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rotate KMS key/i })).not.toBeInTheDocument();
  });

  it('runs an action command and reports success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(new Response(null, { status: 200 }));
    render(<CommandPalette profileId="security" isOpen onClose={noop} onNavigate={noop} />);

    await act(async () => {
      await userEvent.type(screen.getByPlaceholderText(/Type a command/i), 'approve');
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Approve latest snapshot/i }));
    });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('complete'));

    expect(fetchMock).toHaveBeenCalledWith('/api/approvals/approveLatest', expect.any(Object));
  });

  it('navigates for nav commands', async () => {
    const onNavigate = vi.fn();
    render(<CommandPalette profileId="auditor" isOpen onClose={noop} onNavigate={onNavigate} />);

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Open Audit Stream/i }));
    });

    expect(onNavigate).toHaveBeenCalledWith('audit');
  });
});
