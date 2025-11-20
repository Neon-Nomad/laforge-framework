import type { ForgeConfig, GenerationResult, ModelDefinition, RelationDef } from '../ast/types.js';

type UiModel = {
  name: string;
  label: string;
  pluralLabel: string;
  routeSegment: string;
  primaryKey: string;
  displayField: string;
  listFields: string[];
  fields: Array<{ name: string; type: string; optional: boolean; primaryKey: boolean }>;
  relations: RelationDef[];
};

export function generateReactApplication(models: ModelDefinition[], _config: ForgeConfig): GenerationResult[] {
  const uiModels = models.map(buildUiModel);
  const files: GenerationResult[] = [];

  files.push(createPackageJson());
  files.push(createTsConfig());
  files.push(createTsconfigNode());
  files.push(createViteConfig());
  files.push(createIndexHtml());
  files.push(createMainFile());
  files.push(createAppFile(uiModels));
  files.push(createLayoutComponent(uiModels));
  files.push(createDashboardPage());
  files.push(createModelListPage());
  files.push(createModelDetailPage());
  files.push(createModelFormPage());
  files.push(createSchemaFile(uiModels));
  files.push(createSampleDataFile());
  files.push(createStyles());
  files.push({
    filePath: 'src/vite-env.d.ts',
    content: '/// <reference types="vite/client" />',
  });

  return files;
}

function buildUiModel(model: ModelDefinition): UiModel {
  const fields = Object.entries(model.schema)
    .filter(([, definition]) => !(typeof definition === 'object' && (definition as any).__typeName === 'Relation'))
    .map(([name, definition]) => {
      const fieldType = typeof definition === 'string' ? definition : definition.type;
      const optional = typeof definition === 'object' && 'optional' in definition && !!definition.optional;
      const primaryKey = typeof definition === 'object' && 'primaryKey' in definition && !!definition.primaryKey;
      return { name, type: fieldType, optional, primaryKey };
    });

  const pluralLabel = pluralize(model.name);
  const routeSegment = toRouteSegment(pluralLabel);
  const primaryKey = fields.find(f => f.primaryKey)?.name ?? 'id';
  const displayField = pickDisplayField(fields, primaryKey);
  const listFields = computeListFields(fields, primaryKey, displayField);

  return {
    name: model.name,
    label: model.name,
    pluralLabel,
    routeSegment,
    primaryKey,
    displayField,
    listFields,
    fields,
    relations: model.relations,
  };
}

function pickDisplayField(fields: UiModel['fields'], primaryKey: string): string {
  const preferred = fields.find(
    field =>
      field.name !== primaryKey &&
      field.name.toLowerCase() !== 'tenantid' &&
      (field.type === 'string' || field.type === 'text'),
  );
  return preferred?.name ?? primaryKey;
}

function computeListFields(fields: UiModel['fields'], primaryKey: string, displayField: string): string[] {
  const priority = [displayField, primaryKey];
  const extras = fields
    .map(f => f.name)
    .filter(
      name =>
        !priority.includes(name) &&
        name.toLowerCase() !== 'tenantid' &&
        !name.toLowerCase().endsWith('password'),
    );
  return [...new Set([...priority, ...extras])].slice(0, 4);
}

function pluralize(value: string): string {
  if (value.endsWith('y')) {
    return `${value.slice(0, -1)}ies`;
  }
  if (value.endsWith('s')) {
    return `${value}es`;
  }
  return `${value}s`;
}

function toRouteSegment(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function stringify(value: any): string {
  return JSON.stringify(value, null, 2);
}

function createPackageJson(): GenerationResult {
  return {
    filePath: 'package.json',
    content: stringify({
      name: 'laforge-frontend',
      private: true,
      version: '0.0.1',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        'react-router-dom': '^6.22.3',
      },
      devDependencies: {
        typescript: '^5.3.3',
        '@types/react': '^18.2.46',
        '@types/react-dom': '^18.2.18',
        '@types/node': '^20.11.17',
        '@vitejs/plugin-react': '^4.2.1',
        vite: '^5.1.4',
      },
    }),
  };
}

function createTsConfig(): GenerationResult {
  return {
    filePath: 'tsconfig.json',
    content: stringify({
      compilerOptions: {
        target: 'ES2020',
        lib: ['DOM', 'DOM.Iterable', 'ESNext'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        resolveJsonModule: true,
        strict: true,
        jsx: 'react-jsx',
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['src'],
    }),
  };
}

function createTsconfigNode(): GenerationResult {
  return {
    filePath: 'tsconfig.node.json',
    content: stringify({
      compilerOptions: {
        composite: true,
        module: 'ESNext',
        moduleResolution: 'Bundler',
      },
      include: ['vite.config.ts'],
    }),
  };
}

function createViteConfig(): GenerationResult {
  return {
    filePath: 'vite.config.ts',
    content: `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`.trim(),
  };
}

function createIndexHtml(): GenerationResult {
  return {
    filePath: 'index.html',
    content: `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LaForge App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`.trim(),
  };
}

function createMainFile(): GenerationResult {
  return {
    filePath: 'src/main.tsx',
    content: `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`.trim(),
  };
}

function createAppFile(uiModels: UiModel[]): GenerationResult {
  const routes = uiModels
    .map(model => {
      const base = `/${model.routeSegment}`;
      return `
        <Route path="${base}" element={<ModelList modelName="${model.name}" />} />
        <Route path="${base}/new" element={<ModelForm modelName="${model.name}" />} />
        <Route path="${base}/:id" element={<ModelDetail modelName="${model.name}" />} />
        <Route path="${base}/:id/edit" element={<ModelForm modelName="${model.name}" />} />
      `.trim();
    })
    .join('\n');

  return {
    filePath: 'src/App.tsx',
    content: `
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import ModelList from './pages/ModelList';
import ModelDetail from './pages/ModelDetail';
import ModelForm from './pages/ModelForm';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
${routes}
      </Routes>
    </Layout>
  );
}
`.trim(),
  };
}

function createLayoutComponent(uiModels: UiModel[]): GenerationResult {
  return {
    filePath: 'src/components/Layout.tsx',
    content: `
import { Link, NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">LaForge Studio</p>
          <h1>Generated full-stack workspace</h1>
        </div>
        <nav>
          <NavLink to="/">Dashboard</NavLink>
${uiModels
  .map(model => `          <NavLink to="/${model.routeSegment}">${model.pluralLabel}</NavLink>`)
  .join('\n')}
        </nav>
      </header>
      <main>{children}</main>
      <footer>
        <span>Bidirectional relationships rendered from your DSL ?</span>
        <Link to="/">Back to dashboard</Link>
      </footer>
    </div>
  );
}
`.trim(),
  };
}

function createDashboardPage(): GenerationResult {
  return {
    filePath: 'src/pages/Dashboard.tsx',
    content: `
import { Link } from 'react-router-dom';
import { schema } from '../lib/schema';

export default function Dashboard() {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h2>Models compiled from your DSL</h2>
          <p>Each card links into list → detail → related list flows.</p>
        </div>
      </header>
      <div className="model-grid">
        {schema.models.map(model => (
          <article key={model.name} className="model-card">
            <div>
              <p className="eyebrow">{model.fields.length} fields · {model.relations.length} relations</p>
              <h3>{model.pluralLabel}</h3>
              <p>Primary key: {model.primaryKey}</p>
            </div>
            <footer>
              <Link to={'/' + model.routeSegment}>Open list →</Link>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
`.trim(),
  };
}

function createModelListPage(): GenerationResult {
  return {
    filePath: 'src/pages/ModelList.tsx',
    content: `
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getModelMeta } from '../lib/schema';
import { fetchCollection, formatValue } from '../lib/sampleData';

interface Props {
  modelName: string;
}

export default function ModelList({ modelName }: Props) {
  const meta = getModelMeta(modelName);
  const columns = meta.listFields;
  const [records, setRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    fetchCollection(modelName).then(data => {
      if (!active) return;
      setRecords(data);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [modelName]);

  const emptyState = !isLoading && records.length === 0;

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">List</p>
          <h2>{meta.pluralLabel}</h2>
          <p>Click any row to view detail and traverse relationships.</p>
        </div>
        <Link className="btn" to={'/' + meta.routeSegment + '/new'}>
          New {meta.label}
        </Link>
      </header>
      {isLoading ? (
        <p className="empty">Loading records…</p>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                {columns.map(column => (
                  <th key={column}>{column}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {records.map(record => (
                <tr key={record[meta.primaryKey]}>
                  {columns.map(column => (
                    <td key={column}>{formatValue(record[column])}</td>
                  ))}
                  <td className="actions">
                    <Link to={'/' + meta.routeSegment + '/' + record[meta.primaryKey]}>View →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {emptyState && <p className="empty">No records yet—try creating one.</p>}
        </div>
      )}
    </section>
  );
}
`.trim(),
  };
}

function createModelDetailPage(): GenerationResult {
  return {
    filePath: 'src/pages/ModelDetail.tsx',
    content: `
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getInboundRelations, getModelMeta } from '../lib/schema';
import {
  fetchRecordById,
  fetchRelatedCollection,
  formatValue,
  getDisplayValue,
} from '../lib/sampleData';

interface Props {
  modelName: string;
}

export default function ModelDetail({ modelName }: Props) {
  const meta = getModelMeta(modelName);
  const { id } = useParams();
  const inbound = getInboundRelations(modelName);
  const belongsTo = useMemo(() => meta.relations.filter(rel => rel.type === 'belongsTo'), [meta.relations]);
  const outbound = useMemo(() => meta.relations.filter(rel => rel.type === 'hasMany'), [meta.relations]);
  const relationDescriptors = useMemo(
    () => [
      ...outbound.map(rel => ({
        label: rel.name,
        modelName: rel.targetModelName,
        foreignKey: rel.foreignKey,
      })),
      ...inbound.map(rel => ({
        label: rel.sourceModel,
        modelName: rel.sourceModel,
        foreignKey: rel.foreignKey,
      })),
    ],
    [outbound, inbound],
  );

  const [record, setRecord] = useState<Record<string, any> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [parentMap, setParentMap] = useState<Record<string, any | null>>({});
  const [relatedMap, setRelatedMap] = useState<Record<string, any[]>>({});
  const [relatedLoading, setRelatedLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!id) {
      setRecord(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchRecordById(modelName, id).then(data => {
      if (!active) return;
      setRecord(data ?? null);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id, modelName]);

  useEffect(() => {
    if (!record) return;
    let cancelled = false;
    Promise.all(
      belongsTo.map(async rel => {
        const value = record[rel.foreignKey];
        if (!value) {
          return [rel.name, null] as const;
        }
        const parent = await fetchRecordById(rel.targetModelName, value);
        return [rel.name, parent ?? null] as const;
      }),
    ).then(entries => {
      if (cancelled) return;
      setParentMap(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [record, belongsTo]);

  useEffect(() => {
    if (!record) return;
    let cancelled = false;
    setRelatedLoading(true);
    Promise.all(
      relationDescriptors.map(async descriptor => {
        const items = await fetchRelatedCollection({
          sourceModelName: descriptor.modelName,
          foreignKey: descriptor.foreignKey,
          value: record[meta.primaryKey],
        });
        return { key: descriptor.modelName + ':' + descriptor.foreignKey, label: descriptor.label, items };
      }),
    ).then(result => {
      if (cancelled) return;
      const map: Record<string, any[]> = {};
      result.forEach(entry => {
        map[entry.key] = entry.items;
      });
      setRelatedMap(map);
      setRelatedLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [record, relationDescriptors, meta.primaryKey]);

  if (isLoading) {
    return (
      <section className="panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Detail</p>
            <h2>{meta.label}</h2>
          </div>
          <Link className="btn ghost" to={'/' + meta.routeSegment}>
            Back
          </Link>
        </header>
        <p className="empty">Loading record…</p>
      </section>
    );
  }

  if (!record) {
    return (
      <section className="panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Detail</p>
            <h2>{meta.label}</h2>
          </div>
          <Link className="btn ghost" to={'/' + meta.routeSegment}>
            Back
          </Link>
        </header>
        <p className="empty">Record not found.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Detail</p>
          <h2>{getDisplayValue(modelName, record)}</h2>
          <p>Use the cards below to navigate relationships bidirectionally.</p>
        </div>
        <div className="row gap">
          <Link className="btn ghost" to={'/' + meta.routeSegment}>
            ← Back
          </Link>
          <Link className="btn" to={'/' + meta.routeSegment + '/' + record[meta.primaryKey] + '/edit'}>
            Edit
          </Link>
        </div>
      </header>

      <dl className="field-grid">
        {meta.fields.map(field => (
          <div key={field.name}>
            <dt>{field.name}</dt>
            <dd>{formatValue(record[field.name])}</dd>
          </div>
        ))}
      </dl>

      {belongsTo.length > 0 && (
        <div className="relation-stack">
          {belongsTo.map(rel => {
            const parent = parentMap[rel.name];
            const targetMeta = getModelMeta(rel.targetModelName);
            return (
              <article key={rel.name} className="relation-card">
                <header>
                  <p className="eyebrow">Belongs to</p>
                  <h3>{rel.name}</h3>
                </header>
                {parent ? (
                  <Link to={'/' + targetMeta.routeSegment + '/' + parent[targetMeta.primaryKey]}>
                    {getDisplayValue(rel.targetModelName, parent)} →
                  </Link>
                ) : (
                  <p className="empty">No {rel.targetModelName} selected yet.</p>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="relation-stack">
        {relatedLoading && <p className="empty">Loading related records…</p>}
        {!relatedLoading &&
          relationDescriptors.map(descriptor => {
            const targetMeta = getModelMeta(descriptor.modelName);
            const key = descriptor.modelName + ':' + descriptor.foreignKey;
            const relatedRecords = relatedMap[key] || [];
            return (
              <article key={key} className="relation-card">
                <header>
                  <p className="eyebrow">Related</p>
                  <h3>{targetMeta.pluralLabel}</h3>
                </header>
                {relatedRecords.length === 0 ? (
                  <p className="empty">No related records yet.</p>
                ) : (
                  <ul className="related-list">
                    {relatedRecords.map(child => (
                      <li key={child[targetMeta.primaryKey]}>
                        <Link to={'/' + targetMeta.routeSegment + '/' + child[targetMeta.primaryKey]}>
                          {getDisplayValue(descriptor.modelName, child)} →
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
      </div>
    </section>
  );
}
`.trim(),
  };
}

function createModelFormPage(): GenerationResult {
  return {
    filePath: 'src/pages/ModelForm.tsx',
    content: `
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getModelMeta } from '../lib/schema';
import { fetchRecordById, saveRecord } from '../lib/sampleData';

interface Props {
  modelName: string;
}

type FormState = Record<string, string>;

export default function ModelForm({ modelName }: Props) {
  const meta = getModelMeta(modelName);
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>({});
  const [isLoading, setIsLoading] = useState(Boolean(id));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!id) {
      const defaults: FormState = {};
      meta.fields.forEach(field => {
        defaults[field.name] = '';
      });
      setForm(defaults);
      setIsLoading(false);
      return;
    }

    fetchRecordById(modelName, id).then(existing => {
      if (!active) return;
      const draft: FormState = {};
      meta.fields.forEach(field => {
        const value = existing?.[field.name];
        draft[field.name] = value === undefined || value === null ? '' : String(value);
      });
      setForm(draft);
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [id, meta.fields, modelName]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = event.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      const payload: Record<string, any> = {};
      meta.fields.forEach(field => {
        payload[field.name] = form[field.name] ?? null;
      });
      const saved = await saveRecord(modelName, payload, id);
      const nextId = saved?.[meta.primaryKey] ?? id;
      if (nextId) {
        navigate('/' + meta.routeSegment + '/' + nextId);
      } else {
        navigate('/' + meta.routeSegment);
      }
    } finally {
      setIsSaving(false);
    }
  }

  const title = useMemo(() => (id ? 'Update record' : 'New record'), [id]);

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">{id ? 'Edit' : 'Create'} {meta.label}</p>
          <h2>{title}</h2>
        </div>
        <div className="row gap">
          <Link className="btn ghost" to={'/' + meta.routeSegment}>
            Cancel
          </Link>
          <button className="btn" type="submit" form="laforge-form">
            {isSaving ? 'Saving…' : id ? 'Save' : 'Create'}
          </button>
        </div>
      </header>

      {isLoading ? (
        <p className="empty">Loading form…</p>
      ) : (
        <form id="laforge-form" className="form-grid" onSubmit={handleSubmit}>
          {meta.fields.map(field => (
            <label key={field.name}>
              <span>{field.name}</span>
              {field.type === 'text' ? (
                <textarea name={field.name} value={form[field.name] ?? ''} onChange={handleChange} rows={4} />
              ) : (
                <input name={field.name} value={form[field.name] ?? ''} onChange={handleChange} placeholder={field.type} />
              )}
            </label>
          ))}
        </form>
      )}
    </section>
  );
}
`.trim(),
  };
}

function createSchemaFile(uiModels: UiModel[]): GenerationResult {
  const schemaLiteral = stringify(
    uiModels.map(model => ({
      name: model.name,
      label: model.label,
      pluralLabel: model.pluralLabel,
      routeSegment: model.routeSegment,
      primaryKey: model.primaryKey,
      displayField: model.displayField,
      listFields: model.listFields,
      fields: model.fields,
      relations: model.relations,
    })),
  );

  return {
    filePath: 'src/lib/schema.ts',
    content: `
export type UiRelationType = 'belongsTo' | 'hasMany' | 'manyToMany';

export const schema = {
  models: ${schemaLiteral},
} as const;

export type SchemaModel = typeof schema.models[number];
export type SchemaRelation = SchemaModel['relations'][number];

export function getModelMeta(name: string): SchemaModel {
  const meta = schema.models.find(model => model.name === name);
  if (!meta) {
    throw new Error(\`Unknown model: \${name}\`);
  }
  return meta;
}

export function getInboundRelations(targetModelName: string) {
  return schema.models
    .flatMap(model =>
      model.relations
        .filter(rel => rel.type === 'belongsTo' && rel.targetModelName === targetModelName)
        .map(rel => ({
          sourceModel: model.name,
          foreignKey: rel.foreignKey,
        })),
    )
    .filter(
      (rel, index, arr) =>
        arr.findIndex(other => other.sourceModel === rel.sourceModel && other.foreignKey === rel.foreignKey) === index,
    );
}
`.trim(),
  };
}

function createSampleDataFile(): GenerationResult {
  return {
    filePath: 'src/lib/sampleData.ts',
    content: `
import { getModelMeta, schema } from './schema';
import type { SchemaRelation } from './schema';

type RecordMap = Record<string, Array<Record<string, any>>>;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

const records: RecordMap = {};

schema.models.forEach(model => {
  records[model.name] = Array.from({ length: 3 }, (_, index) => {
    const entry: Record<string, any> = {};
    model.fields.forEach(field => {
      entry[field.name] = buildValue(field.type, field.name, index);
    });
    if (!entry[model.primaryKey]) {
      entry[model.primaryKey] = \`\${model.routeSegment}-\${index + 1}\`;
    }
    return entry;
  });
});

schema.models.forEach(model => {
  model.relations
    .filter(rel => rel.type === 'belongsTo')
    .forEach(rel => {
      const targetMeta = getModelMeta(rel.targetModelName);
      const targetRecords = records[targetMeta.name] || [];
      records[model.name].forEach((entry, index) => {
        const linked = targetRecords[index % targetRecords.length];
        if (linked) {
          entry[rel.foreignKey] = linked[targetMeta.primaryKey];
        }
      });
    });
});

function buildValue(type: string, fieldName: string, index: number) {
  switch (type) {
    case 'uuid':
      return \`00000000-0000-0000-0000-\${String(index + 1).padStart(12, '0')}\`;
    case 'integer':
      return (index + 1) * 10;
    case 'boolean':
      return index % 2 === 0;
    case 'datetime':
      return new Date(Date.now() - index * 86400000).toISOString();
    case 'text':
      return \`Sample \${fieldName} paragraph #\${index + 1}\`;
    case 'json':
    case 'jsonb':
      return { placeholder: fieldName, index };
    default:
      return \`\${fieldName} \${index + 1}\`;
  }
}

function safeArrayPayload(payload: any): any[] | null {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return null;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(\`\${API_BASE_URL}\${path}\`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!response.ok) {
    throw new Error(\`Request failed with status \${response.status}\`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

export function getRecords(modelName: string) {
  return records[modelName] || [];
}

export function getRecord(modelName: string, id: string) {
  const meta = getModelMeta(modelName);
  return getRecords(modelName).find(entry => String(entry[meta.primaryKey]) === String(id));
}

export async function fetchCollection(modelName: string) {
  const meta = getModelMeta(modelName);
  try {
    const payload = await request(\`/\${meta.routeSegment}\`);
    const data = safeArrayPayload(payload);
    if (data) return data;
  } catch (error) {
    console.warn(\`[LaForge] Falling back to sample \${modelName} collection.\`, error);
  }
  return getRecords(modelName);
}

export async function fetchRecordById(modelName: string, id: string) {
  if (!id) return undefined;
  const meta = getModelMeta(modelName);
  try {
    const payload = await request(\`/\${meta.routeSegment}/\${encodeURIComponent(id)}\`);
    if (payload) return payload;
  } catch (error) {
    console.warn(\`[LaForge] Falling back to sample detail for \${modelName}.\`, error);
  }
  return getRecord(modelName, id);
}

export async function fetchRelatedCollection(params: { sourceModelName: string; foreignKey: string; value: any }) {
  const meta = getModelMeta(params.sourceModelName);
  try {
    const query = \`?\${encodeURIComponent(params.foreignKey)}=\${encodeURIComponent(params.value ?? '')}\`;
    const payload = await request(\`/\${meta.routeSegment}\${query}\`);
    const data = safeArrayPayload(payload);
    if (data) return data;
  } catch (error) {
    console.warn(\`[LaForge] Falling back to sample related records for \${params.sourceModelName}.\`, error);
  }
  return getRecords(params.sourceModelName).filter(entry => entry[params.foreignKey] === params.value);
}

export async function saveRecord(modelName: string, payload: Record<string, any>, id?: string) {
  const meta = getModelMeta(modelName);
  const path = \`/\${meta.routeSegment}\${id ? '/' + encodeURIComponent(id) : ''}\`;
  const method = id ? 'PATCH' : 'POST';
  try {
    const result = await request(path, {
      method,
      body: JSON.stringify(payload),
    });
    if (result) return result;
  } catch (error) {
    console.warn(\`[LaForge] Save failed for \${modelName}, falling back to local sample data.\`, error);
  }

  if (id) {
    const existing = getRecord(modelName, id);
    if (existing) {
      Object.assign(existing, payload);
      return existing;
    }
  }

  const fallbackId = payload[meta.primaryKey] ?? \`\${meta.routeSegment}-\${Date.now()}\`;
  const newRecord = { ...payload, [meta.primaryKey]: fallbackId };
  if (!records[modelName]) {
    records[modelName] = [];
  }
  records[modelName].push(newRecord);
  return newRecord;
}

export function getParentRecord(relation: SchemaRelation, record: Record<string, any>) {
  const target = getModelMeta(relation.targetModelName);
  const foreignKeyValue = record[relation.foreignKey];
  if (!foreignKeyValue) {
    return undefined;
  }
  return getRecord(target.name, foreignKeyValue);
}

export function getDisplayValue(modelName: string, record: Record<string, any>) {
  const meta = getModelMeta(modelName);
  return record[meta.displayField] ?? record[meta.primaryKey];
}

export function formatValue(value: any) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
`.trim(),
  };
}

function createStyles(): GenerationResult {
  return {
    filePath: 'src/index.css',
    content: `
:root {
  color-scheme: dark;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #020617;
  color: #f8fafc;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: radial-gradient(circle at 10% 20%, rgba(15, 23, 42, 0.95), rgba(2, 6, 23, 0.95));
  min-height: 100vh;
}

a {
  color: inherit;
}

.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 2rem clamp(1rem, 4vw, 3rem);
  gap: 1.5rem;
}

.app-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-end;
}

.app-header nav {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.app-header nav a {
  text-decoration: none;
  color: #94a3b8;
  font-weight: 600;
  padding: 0.4rem 0.8rem;
  border-radius: 999px;
  transition: color 0.2s ease, background 0.2s ease;
}

.app-header nav a.active {
  color: #0f172a;
  background: #38bdf8;
}

main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.panel {
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 1rem;
  padding: clamp(1rem, 3vw, 2rem);
  box-shadow: 0 10px 40px rgba(2, 6, 23, 0.5);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.eyebrow {
  font-size: 0.85rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #38bdf8;
  margin: 0 0 0.4rem 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  border-radius: 0.75rem;
  font-weight: 600;
  background: linear-gradient(120deg, #22d3ee, #0ea5e9);
  color: #020617;
  border: none;
  cursor: pointer;
  text-decoration: none;
}

.btn.ghost {
  background: transparent;
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.4);
}

.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}

.model-card {
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.9rem;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.7);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.model-card footer a {
  text-decoration: none;
  color: #38bdf8;
  font-weight: 600;
}

.table-wrapper {
  border-radius: 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 600px;
}

th,
td {
  padding: 0.85rem 1rem;
  text-align: left;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

th {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #94a3b8;
}

tbody tr:hover {
  background: rgba(56, 189, 248, 0.08);
}

.actions a {
  color: #38bdf8;
  text-decoration: none;
  font-weight: 600;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
  margin: 1.5rem 0;
}

.field-grid dt {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #94a3b8;
  margin-bottom: 0.35rem;
}

.field-grid dd {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
}

.relation-stack {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}

.relation-card {
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.8rem;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.6);
}

.relation-card header h3 {
  margin: 0.2rem 0 0;
}

.related-list {
  list-style: none;
  padding: 0;
  margin: 0.8rem 0 0;
  display: grid;
  gap: 0.4rem;
}

.related-list a {
  text-decoration: none;
  color: #38bdf8;
  font-weight: 500;
}

.form-grid {
  display: grid;
  gap: 1rem;
}

.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-weight: 600;
}

.form-grid input,
.form-grid textarea {
  border-radius: 0.6rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(2, 6, 23, 0.6);
  color: inherit;
  padding: 0.8rem;
  font-family: inherit;
}

.empty {
  color: #94a3b8;
  font-style: italic;
}

.row.gap {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  color: #94a3b8;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
  padding-top: 1rem;
}
`
  };
}
