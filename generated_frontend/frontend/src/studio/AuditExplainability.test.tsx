import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StudioHarness } from './TestHarness';
import { act } from 'react';

const decryptEntry = {
  id: 'a1',
  type: 'decrypt',
  tenantId: 't1',
  userId: 'u1',
  model: 'Post',
  timestamp: new Date().toISOString(),
  data: {
    field: 'body',
    guardPath: 'Post.read',
    residency: { enforced: 'us', violated: false, source: 'test' },
    kms: 'aws',
    keyVersion: 'v2',
    abac: {
      result: 'allow',
      reason: 'owner or admin',
      expression: 'user.id == record.ownerId',
      trace: [{ rule: 'Post.read', result: 'allow', detail: 'owner match' }],
    },
  },
};

const otherEntry = { ...decryptEntry, id: 'x1', type: 'policy_changed' };

const server = setupServer(
  http.get('/api/audit', ({ request }) => {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const entries = type === 'decrypt' ? [decryptEntry] : [otherEntry];
    return HttpResponse.json({ entries });
  }),
  http.get('/api/kms/health', () => HttpResponse.json({ provider: 'aws', version: 'v2', ok: true })),
  http.get('/api/integrity', () => HttpResponse.json({ chain: { ok: true } })),
  http.get('/api/approvals', () => HttpResponse.json({ items: [] })),
  http.post('/api/approvals/decision', () => HttpResponse.json({ ok: true })),
  http.get('/api/drift', () => HttpResponse.json({ enabled: false, reason: 'disabled' })),
  http.get('/api/deploy/verify', () => HttpResponse.json({ ok: true, results: { signed: { ok: true }, approved: { ok: true }, provenance: { ok: true } } })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Audit explainability drawer', () => {
  it('filters decrypts and shows explainability details', async () => {
    await act(async () => {
      render(<StudioHarness />);
    });

    await act(async () => {
      await userEvent.click(screen.getByText('Decrypts'));
    });

    await waitFor(() => expect(screen.getByText('decrypt')).toBeInTheDocument());

    const row = screen.getByText('decrypt').closest('tr') as HTMLElement;
    await act(async () => {
      await userEvent.click(row);
    });

    await waitFor(() => expect(screen.getByTestId('guard-path')).toBeInTheDocument());
    expect(screen.getByTestId('guard-path')).toHaveTextContent('Post.read');
    expect(screen.getByTestId('residency')).toHaveTextContent('us');
    expect(screen.getByTestId('kms')).toHaveTextContent('aws');
    expect(screen.getByTestId('abac-reason')).toHaveTextContent('owner or admin');
    expect(screen.getByLabelText('abac-trace')).toHaveTextContent('owner match');
    expect(screen.getByLabelText('raw-event')).toHaveTextContent('decrypt');
  });
});
