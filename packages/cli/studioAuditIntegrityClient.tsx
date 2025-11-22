/// <reference lib="dom" />
import React from 'react';
import { createRoot } from 'react-dom/client';
import { StudioHarness } from '../../generated_frontend/frontend/src/studio/TestHarness.tsx';

const container = document.getElementById('laforge-audit-integrity-root');

if (container) {
  const root = createRoot(container);
  root.render(<StudioHarness panels={['audit', 'integrity']} />);
}
