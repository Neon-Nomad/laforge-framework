import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StudioHarness } from './TestHarness';
import { act } from 'react';

const server = setupServer(
  http.get('/api/audit', () => HttpResponse.json({ entries: [] })),
  http.get('/api/kms/health', () => HttpResponse.json({ provider: 'vault', version: 'v5', ok: true })),
  http.get('/api/integrity', () => HttpResponse.json({ chain: { ok: true }, snapshots: [] })),
  http.get('/api/approvals', () => HttpResponse.json({ items: [] })),
  http.post('/api/approvals/decision', () => HttpResponse.json({ ok: true })),
  http.get('/api/drift', () => HttpResponse.json({ enabled: false, reason: 'disabled' })),
  http.get('/api/deploy/verify', () => HttpResponse.json({ ok: true, results: { signed: { ok: true }, approved: { ok: true }, provenance: { ok: true } } })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Integrity panel', () => {
  it('shows kms health and chain status', async () => {
    await act(async () => {
      render(<StudioHarness />);
    });
    await waitFor(() => expect(screen.getByLabelText('kms-health')).toHaveTextContent('vault'));
    expect(screen.getByLabelText('kms-health')).toHaveTextContent('v5');
    await waitFor(() => expect(screen.getByLabelText('integrity-status')).toHaveTextContent('chain-ok'));
  });
});
