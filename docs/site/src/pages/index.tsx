import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

export default function Home(): JSX.Element {
  return (
    <Layout
      title="LaForge"
      description="Policy-first backend compiler"
    >
      <main>
        <div className="hero hero--primary">
          <div className="container">
            <h1 className="hero__title">LaForge</h1>
            <p className="hero__subtitle">
              Policy-first backend compiler: schema, RLS, services, routes, validation, and migrations from one domain definition.
            </p>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <Link className="button button--lg button--secondary" to="/handbook">
                Read the Handbook
              </Link>
              <Link className="button button--lg" to="/migration-workflow">
                Migration Workflow
              </Link>
            </div>
          </div>
        </div>
        <div className="container margin-vert--lg">
          <div className="row">
            <div className="col col--6">
              <h2>Why LaForge</h2>
              <ul>
                <li>Policy-first: policies drive schema, RLS, routes, and services.</li>
                <li>Zero drift: schema, policies, and services share one AST.</li>
                <li>Multi-DB: Postgres, MySQL, and SQLite generation + migration apply.</li>
                <li>Safe by default: migration drift detection, safe vs destructive modes.</li>
              </ul>
            </div>
            <div className="col col--6">
              <h2>Quick Links</h2>
              <ul>
                <li><Link to="/dsl-guide">DSL Guide</Link></li>
                <li><Link to="/multi-db-guide">Multi-DB Guide</Link></li>
                <li><Link to="/plugins">Plugin Guide</Link></li>
                <li><Link to="/cli">CLI Reference</Link></li>
                <li><Link to="/roadmap">Roadmap</Link></li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </Layout>
  );
}
