
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useUser, useDeleteUser } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: item, isLoading, error } = useUser(id || '');
  const deleteMutation = useDeleteUser();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!item) return <div>Not found</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">User Details</h2>
        <div className="space-x-2">
          <Button variant="outline" asChild>
            <Link to="/users">Back</Link>
          </Button>
          <Button asChild>
            <Link to={`/users/${item.id}/edit`}>Edit</Link>
          </Button>
          <Button 
            variant="destructive" 
            onClick={() => {
              if (confirm('Are you sure?')) {
                deleteMutation.mutate(item.id, {
                  onSuccess: () => navigate('/users')
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
            <dt className="text-sm font-medium text-muted-foreground">email</dt>
            <dd className="text-sm font-semibold">{String(item.email)}</dd>
          </div>
          
          <div className="grid gap-1">
            <dt className="text-sm font-medium text-muted-foreground">name</dt>
            <dd className="text-sm font-semibold">{String(item.name)}</dd>
          </div>
          
          <div className="grid gap-1">
            <dt className="text-sm font-medium text-muted-foreground">role</dt>
            <dd className="text-sm font-semibold">{String(item.role)}</dd>
          </div>
          
          <div className="grid gap-1">
            <dt className="text-sm font-medium text-muted-foreground">isActive</dt>
            <dd className="text-sm font-semibold">{String(item.isActive)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
