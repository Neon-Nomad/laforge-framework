import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StudioHarness } from './TestHarness';
import { act } from 'react';

const piiDenied = {
  id: 'p1',
  type: 'pii_reveal_denied',
  tenantId: 'tenantX',
  userId: 'attacker',
  model: 'User',
  timestamp: new Date().toISOString(),
  data: {
    field: 'ssn',
    guardPath: 'User.read',
    residency: { enforced: 'eu', violated: true, source: 'test' },
    kms: 'aws',
    keyVersion: 'v1',
    abac: { result: 'deny', reason: 'Residency mismatch', expression: 'user.region == record.region' },
  },
};

const server = setupServer(
  http.get('/api/audit', ({ request }) => {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    if (type === 'pii_reveal_denied') {
      return HttpResponse.json({ entries: [piiDenied] });
    }
    return HttpResponse.json({ entries: [] });
  }),
  http.get('/api/kms/health', () => HttpResponse.json({ provider: 'aws', version: 'v1', ok: true })),
  http.get('/api/integrity', () => HttpResponse.json({ chain: { ok: true } })),
  http.get('/api/approvals', () => HttpResponse.json({ items: [] })),
  http.post('/api/approvals/decision', () => HttpResponse.json({ ok: true })),
  http.get('/api/drift', () => HttpResponse.json({ enabled: false, reason: 'disabled' })),
  http.get('/api/deploy/verify', () => HttpResponse.json({ ok: true, results: { signed: { ok: true }, approved: { ok: true }, provenance: { ok: true } } })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Audit preset for PII denials', () => {
  it('filters and opens drawer with deny reasons', async () => {
    await act(async () => {
      render(<StudioHarness />);
    });

    await act(async () => {
      await userEvent.click(screen.getByText('PII Denials'));
    });
    await waitFor(() => expect(screen.getByText('pii_reveal_denied')).toBeInTheDocument());
    const row = screen.getByText('pii_reveal_denied').closest('tr') as HTMLElement;
    await act(async () => {
      await userEvent.click(row);
    });
    await waitFor(() => expect(screen.getByLabelText('raw-event')).toBeInTheDocument());

    expect(screen.getByTestId('residency')).toHaveTextContent('eu');
    expect(screen.getByTestId('abac-reason')).toHaveTextContent('Residency mismatch');
  });
});
