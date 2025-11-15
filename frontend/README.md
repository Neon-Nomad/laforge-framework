# 🔥 LaForge Sandbox Dashboard

A complete, interactive browser-based development workspace for the LaForge Backend Compiler. Define models, policies, and hooks in the Forge DSL, compile them in real-time, and simulate backend operations—all in your browser!

## Features

### ✨ Complete Development Environment
- **Monaco Editor**: Full-featured code editor with syntax highlighting
- **Real-time Compilation**: Instant feedback as you write Forge DSL
- **Multi-Tab Output**: View AST, SQL, RLS Policies, Domain Services, API Routes
- **Runtime Simulation**: Test CRUD operations with policy enforcement

### 🎯 Built With
- **React 18**: Modern, performant UI
- **Material-UI (MUI)**: Enterprise-grade component library
- **Monaco Editor**: VS Code's editor engine
- **TypeScript**: Type-safe development
- **Vite**: Lightning-fast development server

### 🔐 Security Features
- In-memory database simulation
- Real-time policy evaluation
- Multi-tenant support
- Role-based access control (RBAC)
- Audit logging for all operations

## Quick Start

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open browser to http://localhost:5173
```

### Build for Production

```bash
npm run build
npm run preview
```

## Dashboard Layout

### Left Panel: DSL Editor
Write your Forge DSL code defining:
- **Models**: Data structures with typed fields
- **Policies**: Authorization rules for CRUD operations
- **Hooks**: Lifecycle events (beforeCreate, afterCreate, etc.)
- **Relations**: belongsTo, hasMany, manyToMany

### Right Panel: Generated Artifacts (Tabs)

1. **AST Tab**: Parsed Abstract Syntax Tree as JSON
2. **SQL Schema Tab**: Generated CREATE TABLE statements
3. **RLS Policies Tab**: PostgreSQL Row-Level Security policies
4. **Domain Services Tab**: TypeScript domain service classes
5. **API Routes Tab**: Fastify route handlers
6. **Runtime Tab**: Interactive simulation environment

## Runtime Simulation

The Runtime tab provides a fully functional in-memory backend where you can:

### CRUD Operations
- **Create**: Add new records with automatic ID generation
- **Read**: Query records with policy filtering
- **Update**: Modify existing records (policy-enforced)
- **Delete**: Remove records (policy-enforced)

### Policy Enforcement
All operations respect the policies you defined in the DSL. Try creating records with different user roles to see policies in action!

### User Context
Switch between user roles (User/Admin) to test different permission scenarios:
- User ID: `user-123`
- Tenant ID: `tenant-abc`
- Role: `user` or `admin` (switchable)

### Audit Log
Every operation is logged with:
- Timestamp
- Operation type (CREATE/READ/UPDATE/DELETE)
- Success/failure status
- Policy decisions
- User context

## Example DSL

```forge
model User {
  id: uuid pk
  tenantId: uuid tenant
  email: string
  role: string default "user"
  createdAt: datetime default "now()"
}

model Post {
  id: uuid pk
  tenantId: uuid tenant
  title: string
  content: text
  authorId: uuid
  published: boolean default "false"
  createdAt: datetime default "now()"
}

policy User.read {
  ({ user, record }) => record.id === user.id || user.role === 'admin'
}

policy Post.create {
  ({ user }) => true
}

policy Post.update {
  ({ user, record }) => record.authorId === user.id
}

policy Post.delete {
  ({ user, record }) => record.authorId === user.id || user.role === 'admin'
}

hook Post.beforeCreate {
  (data) => {
    if (!data.published) {
      return { published: false };
    }
  }
}
```

## How It Works

### 1. Write DSL
Define your domain models, authorization policies, and business logic in the Monaco editor.

### 2. Compile
Click "Compile DSL" to transform your definitions into:
- TypeScript types and validation schemas (Zod)
- SQL CREATE TABLE statements
- PostgreSQL RLS policies
- Domain service classes with CRUD methods
- Fastify API route handlers

### 3. Simulate
Switch to the Runtime tab to:
- Create records in an in-memory database
- Test policy enforcement
- Execute lifecycle hooks
- View audit logs

### 4. Inspect
Examine all generated artifacts in their respective tabs to understand exactly what LaForge produces.

## Architecture

```
┌─────────────────────────────────────────────────┐
│           LaForge Sandbox Dashboard             │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌──────────────┐         ┌─────────────────┐  │
│  │              │         │                 │  │
│  │  DSL Editor  │────────▶│   Compiler      │  │
│  │  (Monaco)    │         │   (TypeScript)  │  │
│  │              │         │                 │  │
│  └──────────────┘         └────────┬────────┘  │
│                                    │            │
│                           ┌────────▼────────┐   │
│                           │  Generated      │   │
│                           │  Artifacts:     │   │
│                           │  • AST          │   │
│                           │  • SQL          │   │
│                           │  • RLS          │   │
│                           │  • Domain       │   │
│                           │  • Routes       │   │
│                           └────────┬────────┘   │
│                                    │            │
│                           ┌────────▼────────┐   │
│                           │  Runtime        │   │
│                           │  Simulation     │   │
│                           │  • In-Memory DB │   │
│                           │  • Policy Check │   │
│                           │  • Audit Log    │   │
│                           └─────────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| UI Framework | React 18 |
| Component Library | Material-UI v5 |
| Code Editor | Monaco Editor |
| Language | TypeScript |
| Build Tool | Vite |
| Styling | Emotion (MUI) |
| State Management | React Hooks |
| UUID Generation | uuid |
| DSL Parsing | Babel Parser |
| Validation | Zod |

## Development

### Project Structure

```
src/
├── App.tsx                   # Main application component
├── main.tsx                  # Entry point
├── components/
│   ├── MonacoEditor.tsx      # Code editor wrapper
│   └── RuntimeSimulation.tsx # In-memory backend simulator
└── compiler/
    ├── main.ts               # Compiler orchestrator
    ├── types.ts              # Type definitions
    ├── registry.ts           # Model registry
    ├── zodGenerator.ts       # Zod schema generator
    ├── migrationGenerator.ts # SQL schema generator
    ├── astToRls.ts           # RLS policy compiler
    ├── domainGenerator.ts    # Domain service generator
    └── fastifyAdapter.ts     # API route generator
```

### Adding New Features

#### New Generator
1. Create file in `src/compiler/`
2. Export a function that takes `ModelDefinition[]`
3. Return generated code as a string
4. Import and call in `main.ts`

#### New Runtime Feature
1. Modify `RuntimeSimulation.tsx`
2. Add state for your feature
3. Update the UI to expose controls
4. Add audit logging

## Deployment

### Static Hosting
The dashboard is a pure client-side application:

```bash
npm run build
# Upload dist/ to: Netlify, Vercel, GitHub Pages, S3, etc.
```

### Docker

```dockerfile
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

## Roadmap

- [ ] Export generated code as downloadable files
- [ ] Import/export DSL definitions
- [ ] Schema version diff viewer
- [ ] Visual query builder
- [ ] GraphQL adapter generation
- [ ] WebSocket support for realtime
- [ ] Database connection for real PostgreSQL testing
- [ ] Multi-file DSL projects
- [ ] Collaboration features

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - feel free to use this in your projects!

## Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Documentation**: See `/docs` folder

---

Built with ❤️ for the LaForge Backend Compiler community
