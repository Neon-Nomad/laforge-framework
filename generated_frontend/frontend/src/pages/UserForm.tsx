
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useUser, useCreateUser, useUpdateUser } from '@/lib/queries';

import { UserSchema, CreateUserSchema } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { z } from 'zod';

type FormData = z.infer<typeof CreateUserSchema>;

export function UserForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const { data: record, isLoading } = useUser(id || '');
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();

  // Fetch relations
  

  const form = useForm<FormData>({
    resolver: zodResolver(CreateUserSchema),
  });

  useEffect(() => {
    if (record) {
      form.reset(record);
    }
  }, [record, form]);

  const onSubmit = (data: FormData) => {
    if (isEdit && id) {
      updateMutation.mutate({ id, data }, {
        onSuccess: () => navigate('/users')
      });
    } else {
      createMutation.mutate(data, {
        onSuccess: () => navigate('/users')
      });
    }
  };

  if (isEdit && isLoading) return <div>Loading...</div>;

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-2xl font-bold mb-6">{isEdit ? 'Edit' : 'Create'} User</h2>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        
        <div className="space-y-2">
          <Label htmlFor="email">email</Label>
          <Input id="email" {...form.register('email')} />
          {form.formState.errors.email && <p className="text-sm text-red-500">{form.formState.errors.email?.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">name</Label>
          <Input id="name" {...form.register('name')} />
          {form.formState.errors.name && <p className="text-sm text-red-500">{form.formState.errors.name?.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="role">role</Label>
          <Input id="role" {...form.register('role')} />
          {form.formState.errors.role && <p className="text-sm text-red-500">{form.formState.errors.role?.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="isActive">isActive</Label>
          <Input id="isActive" {...form.register('isActive')} />
          {form.formState.errors.isActive && <p className="text-sm text-red-500">{form.formState.errors.isActive?.message}</p>}
        </div>
        
        < div className="flex gap-2" >
            <Button type="submit" disabled = { createMutation.isPending || updateMutation.isPending } >
                { isEdit? 'Update': 'Create' }
                </Button>
                < Button type="button" variant="outline" onClick={() => navigate('/users')
        } >
            Cancel
            </Button>
            </div>
            </form>
            </div>
        );
    }
