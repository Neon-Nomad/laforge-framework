import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StudioHarness } from './TestHarness';
import { act } from 'react';

const approvalsPayload = {
  items: [
    {
      id: 'snap-1',
      branch: 'main',
      approved: false,
      approvals: [],
    },
  ],
};

const decisions: Array<Record<string, any>> = [];
let guardCallCount = 0;

const server = setupServer(
  http.get('/api/audit', () => HttpResponse.json({ entries: [] })),
  http.get('/api/kms/health', () => HttpResponse.json({ provider: 'aws', version: 'v1', ok: true })),
  http.get('/api/integrity', () => HttpResponse.json({ chain: { ok: true } })),
  http.get('/api/approvals', () => HttpResponse.json(approvalsPayload)),
  http.post('/api/approvals/decision', async ({ request }) => {
    const body = await request.json();
    decisions.push(body);
    approvalsPayload.items[0].approved = body.decision === 'approved';
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/drift', () => HttpResponse.json({ enabled: true, drift: [], dbPath: ':memory:' })),
  http.get('/api/deploy/verify', () => {
    guardCallCount += 1;
    return HttpResponse.json({
      ok: guardCallCount > 1,
      results: {
        signed: { ok: true },
        approved: { ok: guardCallCount > 1 },
        provenance: { ok: true },
      },
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  decisions.length = 0;
  guardCallCount = 0;
  server.resetHandlers();
});
afterAll(() => server.close());

describe('Approvals panel', () => {
  it('submits approval decisions and refreshes rows', async () => {
    await act(async () => {
      render(<StudioHarness />);
    });

    await waitFor(() => expect(screen.getByLabelText('approvals-table')).toHaveTextContent('snap-1'));

    await act(async () => {
      await userEvent.click(screen.getAllByText('Approve')[0]);
    });

    await waitFor(() => expect(decisions.length).toBe(1));
    expect(decisions[0]).toMatchObject({ id: 'snap-1', decision: 'approved' });
    await waitFor(() => expect(screen.getByTestId('approval-status-snap-1')).toHaveTextContent('approved'));
  });
});
