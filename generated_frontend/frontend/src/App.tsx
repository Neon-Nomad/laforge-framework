
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { useRealtime } from './lib/realtime';
import { UserList } from './pages/UserList';
import { UserForm } from './pages/UserForm';
import { UserDetail } from './pages/UserDetail';
import { PostList } from './pages/PostList';
import { PostForm } from './pages/PostForm';
import { PostDetail } from './pages/PostDetail';

function App() {
  useRealtime();
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          
          <Route path="users" element={<UserList />} />
          <Route path="users/new" element={<UserForm />} />
          <Route path="users/:id" element={<UserDetail />} />
          <Route path="users/:id/edit" element={<UserForm />} />
          
          <Route path="posts" element={<PostList />} />
          <Route path="posts/new" element={<PostForm />} />
          <Route path="posts/:id" element={<PostDetail />} />
          <Route path="posts/:id/edit" element={<PostForm />} />
          
        </Route>
      </Routes>
    </Router>
  )
}

export default App
    