import React from 'react';
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GovernanceApp } from './TestHarness';
import { act } from 'react';

const server = setupServer(
  http.get('/api/audit', () => HttpResponse.json({ entries: [] })),
  http.get('/api/kms/health', () => HttpResponse.json({ provider: 'aws', version: 'v1', ok: true })),
  http.get('/api/integrity', () => HttpResponse.json({ chain: { ok: true }, snapshots: [] })),
  http.get('/api/approvals', () => HttpResponse.json({ items: [] })),
  http.get('/api/drift', () => HttpResponse.json({ enabled: false, reason: 'disabled' })),
  http.get('/api/deploy/verify', () => HttpResponse.json({ ok: true, results: {} })),
);

beforeAll(() => server.listen());
beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage?.clear();
  }
});

afterEach(async () => {
  server.resetHandlers();
  if (typeof window !== 'undefined') {
    await act(async () => {
      window.location.hash = '';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  }
});
afterAll(() => server.close());

describe('GovernanceApp router', () => {
  it('renders overview and navigates via sidebar', async () => {
    render(<GovernanceApp />);

    await waitFor(() => expect(screen.getByRole('heading', { name: /Audit Stream/i })).toBeInTheDocument());

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Integrity & KMS/i }));
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: /Integrity & KMS/i })).toBeInTheDocument());
  });

  it('opens command palette and runs commands', async () => {
    render(<GovernanceApp />);

    await waitFor(() => expect(screen.getByRole('heading', { name: /Audit Stream/i })).toBeInTheDocument());

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Command Palette/ }));
    });

    await act(async () => {
      await userEvent.type(screen.getByPlaceholderText(/Type a command/i), 'integrity');
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Open Integrity & KMS/i }));
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: /Integrity & KMS/i })).toBeInTheDocument());
  });

  it('switches role profile and enforces allowed view', async () => {
    render(<GovernanceApp />);

    await waitFor(() => expect(screen.getByRole('heading', { name: /Audit Stream/i })).toBeInTheDocument());

    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText(/Role Mode/i), 'platform');
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: /Operations Guard/i })).toBeInTheDocument());
  });

  it('persists and restores selected role', async () => {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('laforge:governance:profile', 'security');
    }
    render(<GovernanceApp />);

    await waitFor(() => expect(screen.getByRole('heading', { name: /Integrity & KMS/i })).toBeInTheDocument());

    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText(/Role Mode/i), 'developer');
    });

    await waitFor(() => expect(window.localStorage?.getItem('laforge:governance:profile')).toBe('developer'));
  });
});
