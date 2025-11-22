/// <reference lib="dom" />
import React from 'react';
import { createRoot } from 'react-dom/client';
import { GovernanceApp } from '../../generated_frontend/frontend/src/studio/TestHarness.tsx';

function GovernanceShell() {
  return (
    <div
      style={{
        fontFamily: "'Space Grotesk', system-ui, -apple-system, sans-serif",
        padding: '24px',
        color: '#e5e7eb',
        background: '#05060c',
        minHeight: '100vh',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>LaForge Governance Suite</h1>
        <a
          href="/"
          style={{
            color: '#00d2ff',
            textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '999px',
            padding: '8px 14px',
          }}
        >
          Return to Studio
        </a>
      </div>
      <GovernanceApp />
    </div>
  );
}

const rootEl = document.getElementById('laforge-governance-root');

if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<GovernanceShell />);
}
