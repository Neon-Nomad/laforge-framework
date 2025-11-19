
import { Link, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="flex h-screen bg-background">
      <aside className="w-64 border-r bg-card p-4">
        <h1 className="text-xl font-bold mb-6">LaForge App</h1>
        <nav className="space-y-2">
          <Link to="/" className="block p-2 rounded hover:bg-accent">Dashboard</Link>
          <Link to="/users" className="block p-2 rounded hover:bg-accent">Users</Link>
          <Link to="/posts" className="block p-2 rounded hover:bg-accent">Posts</Link>
        </nav>
      </aside>
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
