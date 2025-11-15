# 🚀 QuickStart Guide

Get the LaForge Sandbox Dashboard running in 2 minutes!

## Prerequisites

- Node.js 18 or later
- npm or yarn

## Installation & Running

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev

# 3. Open your browser
# Navigate to: http://localhost:5173
```

That's it! The dashboard should now be running.

## First Steps

### 1. Review the Default Example
The editor loads with a pre-populated example showing:
- Two models: `User` and `Post`
- Authorization policies for both models
- A lifecycle hook for `Post`

### 2. Compile the DSL
Click the green **"Compile DSL"** button in the top-right corner.

### 3. Explore the Generated Code
Click through the tabs at the top of the right panel:
- **AST**: See the parsed structure
- **SQL Schema**: View CREATE TABLE statements
- **RLS Policies**: Check PostgreSQL security policies
- **Domain Services**: Inspect TypeScript service classes
- **API Routes**: Review Fastify route handlers

### 4. Test the Runtime
1. Click the **Runtime** tab
2. Select a model (e.g., "Post")
3. Select "Create" operation
4. Fill in the form fields:
   - `title`: "My First Post"
   - `content`: "Hello LaForge!"
   - `authorId`: `user-123`
5. Click **"Create Post"**
6. Watch the audit log populate!

### 5. Test Policies
1. Try to update a post with a different `authorId`
2. Notice the policy denial in the audit log
3. Switch user role to "Admin" in the top-right
4. Try the update again—it should succeed!

## Common Operations

### Create a New Model

```forge
model Comment {
  id: uuid pk
  tenantId: uuid tenant
  content: text
  postId: uuid
  authorId: uuid
  createdAt: datetime default "now()"
}
```

### Add a Policy

```forge
policy Comment.create {
  ({ user }) => true
}

policy Comment.delete {
  ({ user, record }) => record.authorId === user.id || user.role === 'admin'
}
```

### Add a Hook

```forge
hook Comment.beforeCreate {
  (data) => {
    // Sanitize content
    if (data.content) {
      return { content: data.content.trim() };
    }
  }
}
```

### Define Relations

```forge
model Post {
  id: uuid pk
  // ... other fields ...
  comments: hasMany('Comment')
}

model Comment {
  id: uuid pk
  // ... other fields ...
  post: belongsTo('Post')
}
```

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Format Code | `Shift + Alt + F` |
| Find | `Ctrl/Cmd + F` |
| Replace | `Ctrl/Cmd + H` |
| Command Palette | `F1` |
| Toggle Comment | `Ctrl/Cmd + /` |

## Troubleshooting

### Port 5173 Already in Use
```bash
# Kill the process using the port
# Linux/Mac:
lsof -ti:5173 | xargs kill -9

# Or change the port in vite.config.ts:
export default defineConfig({
  server: { port: 3000 }
});
```

### Monaco Editor Not Loading
Clear your browser cache and reload.

### Compilation Errors
Check the error panel at the top of the right side. Common issues:
- Missing closing braces `}`
- Typos in model names
- Invalid field types
- Syntax errors in policy/hook bodies

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Experiment with different models and policies
- Try the multi-tenant features
- Test role-based access control
- Export your generated code (feature coming soon!)

## Need Help?

- Check the [README.md](README.md)
- Open an issue on GitHub
- Join the community discussions

Happy building! 🔥
