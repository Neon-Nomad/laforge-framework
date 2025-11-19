
import { Link } from 'react-router-dom';
import { usePosts, useDeletePost } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function PostList() {
  const { data: posts, isLoading, error } = usePosts();
  const deleteMutation = useDeletePost();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Posts</h2>
        <Button asChild>
          <Link to="/posts/new">Create Post</Link>
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>title</TableHead>
              <TableHead>content</TableHead>
              <TableHead>published</TableHead>
              <TableHead>authorId</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts?.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{String(item.title)}</TableCell>
                <TableCell>{String(item.content)}</TableCell>
                <TableCell>{String(item.published)}</TableCell>
                <TableCell>{String(item.authorId)}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/posts/${item.id}`}>Edit</Link>
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => {
                      if (confirm('Are you sure?')) {
                        deleteMutation.mutate(item.id);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
