
import { Link } from 'react-router-dom';
import { useUsers, useDeleteUser } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function UserList() {
  const { data: users, isLoading, error } = useUsers();
  const deleteMutation = useDeleteUser();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Users</h2>
        <Button asChild>
          <Link to="/users/new">Create User</Link>
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>email</TableHead>
              <TableHead>name</TableHead>
              <TableHead>role</TableHead>
              <TableHead>isActive</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users?.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{String(item.email)}</TableCell>
                <TableCell>{String(item.name)}</TableCell>
                <TableCell>{String(item.role)}</TableCell>
                <TableCell>{String(item.isActive)}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/users/${item.id}`}>Edit</Link>
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
