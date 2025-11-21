import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { StudioHarness } from './TestHarness';

let healthVersion = 'v1';
const auditEntries = [{ id: 'd1', type: 'decrypt', timestamp: new Date().toISOString() }];

const server = setupServer(
  http.get('/api/audit', () => HttpResponse.json({ entries: auditEntries })),
  http.post('/api/kms/rotate', async ({ request }) => {
    const body = await request.json();
    // @ts-expect-error body is typed as unknown by msw v2
    healthVersion = body.version || 'v-next';
    // @ts-expect-error list tokens
    const tokens = body.tokens || [];
    return HttpResponse.json({
      rotated: tokens.map((t: string) => `${t}-rotated`),
      // @ts-expect-error provider is dynamic
      provider: body.provider || 'aws',
      version: healthVersion,
    });
  }),
  http.get('/api/kms/health', () => HttpResponse.json({ provider: 'aws', version: healthVersion, ok: true })),
  http.get('/api/integrity', () => HttpResponse.json({ chain: { ok: true } })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('KMS rotation UI', () => {
  it('rotates tokens, refreshes health, and refreshes audit', async () => {
    render(<StudioHarness />);
    await waitFor(() => expect(screen.getByLabelText('kms-health')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('kms-provider'), 'aws');
    await userEvent.type(screen.getByLabelText('kms-version'), 'v2');
    await userEvent.type(screen.getByLabelText('kms-tokens'), 'token-a');
    await userEvent.click(screen.getByText('Rotate'));

    await waitFor(() => expect(screen.getByLabelText('kms-rotate-status')).toHaveTextContent('done'));
    await waitFor(() => expect(screen.getByLabelText('kms-health')).toHaveTextContent('v2'));
    const row = screen.getByText('decrypt').closest('tr') as HTMLElement;
    expect(row).toBeInTheDocument();
  });
});
