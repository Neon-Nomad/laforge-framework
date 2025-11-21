import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import { StudioHarness } from './TestHarness';

const server = setupServer(
  rest.get('/api/audit', (_req, res, ctx) => res(ctx.json({ entries: [] }))),
  rest.get('/api/kms/health', (_req, res, ctx) => res(ctx.json({ provider: 'vault', version: 'v5', ok: true }))),
  rest.get('/api/integrity', (_req, res, ctx) => res(ctx.json({ chain: { ok: true }, snapshots: [] }))),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Integrity panel', () => {
  it('shows kms health and chain status', async () => {
    render(<StudioHarness />);
    await waitFor(() => expect(screen.getByLabelText('kms-health')).toHaveTextContent('vault'));
    expect(screen.getByLabelText('kms-health')).toHaveTextContent('v5');
    await waitFor(() => expect(screen.getByLabelText('integrity-status')).toHaveTextContent('chain-ok'));
  });
});
