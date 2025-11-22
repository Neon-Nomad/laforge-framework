import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StudioHarness } from './TestHarness';
import { act } from 'react';

const guardResponses = [
  {
    ok: false,
    reason: 'pending approval',
    results: {
      signed: { ok: true },
      approved: { ok: false },
      provenance: { ok: true },
    },
  },
  {
    ok: true,
    reason: '',
    results: {
      signed: { ok: true },
      approved: { ok: true },
      provenance: { ok: true },
    },
  },
];

let guardCall = 0;

const server = setupServer(
  http.get('/api/audit', () => HttpResponse.json({ entries: [] })),
  http.get('/api/kms/health', () => HttpResponse.json({ provider: 'aws', version: 'v1', ok: true })),
  http.get('/api/integrity', () => HttpResponse.json({ chain: { ok: true } })),
  http.get('/api/approvals', () => HttpResponse.json({ items: [] })),
  http.post('/api/approvals/decision', () => HttpResponse.json({ ok: true })),
  http.get('/api/drift', () => HttpResponse.json({ enabled: false, reason: 'disabled' })),
  http.get('/api/deploy/verify', () => {
    const payload = guardResponses[Math.min(guardCall, guardResponses.length - 1)];
    guardCall += 1;
    return HttpResponse.json(payload);
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  guardCall = 0;
  server.resetHandlers();
});
afterAll(() => server.close());

describe('Deploy guard panel', () => {
  it('shows guard status and refreshes on verify click', async () => {
    await act(async () => {
      render(<StudioHarness />);
    });

    await waitFor(() => expect(screen.getByLabelText('deploy-guard-status')).toHaveTextContent('blocked'));
    await waitFor(() => expect(screen.getByLabelText('deploy-guard-details')).toHaveTextContent('approved: pending'));

    await act(async () => {
      await userEvent.click(screen.getByText('Verify guard'));
    });

    await waitFor(() => expect(screen.getByLabelText('deploy-guard-status')).toHaveTextContent('ready'));
    expect(guardCall).toBeGreaterThanOrEqual(2);
  });
});
