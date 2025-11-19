
import { Link, useParams, useNavigate } from 'react-router-dom';
import { usePost, useDeletePost } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: item, isLoading, error } = usePost(id || '');
  const deleteMutation = useDeletePost();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!item) return <div>Not found</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Post Details</h2>
        <div className="space-x-2">
          <Button variant="outline" asChild>
            <Link to="/posts">Back</Link>
          </Button>
          <Button asChild>
            <Link to={`/posts/${item.id}/edit`}>Edit</Link>
          </Button>
          <Button 
            variant="destructive" 
            onClick={() => {
              if (confirm('Are you sure?')) {
                deleteMutation.mutate(item.id, {
                  onSuccess: () => navigate('/posts')
                });
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-4">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          
          <div className="grid gap-1">
            <dt className="text-sm font-medium text-muted-foreground">title</dt>
            <dd className="text-sm font-semibold">{String(item.title)}</dd>
          </div>
          
          <div className="grid gap-1">
            <dt className="text-sm font-medium text-muted-foreground">content</dt>
            <dd className="text-sm font-semibold">{String(item.content)}</dd>
          </div>
          
          <div className="grid gap-1">
            <dt className="text-sm font-medium text-muted-foreground">published</dt>
            <dd className="text-sm font-semibold">{String(item.published)}</dd>
          </div>
          
          <div className="grid gap-1">
            <dt className="text-sm font-medium text-muted-foreground">authorId</dt>
            <dd className="text-sm font-semibold">{String(item.authorId)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
