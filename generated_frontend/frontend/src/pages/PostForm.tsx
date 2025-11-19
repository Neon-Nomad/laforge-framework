
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { usePost, useCreatePost, useUpdatePost } from '@/lib/queries';
import { useUsers } from '@/lib/queries';
import { PostSchema, CreatePostSchema } from '@/lib/schemas';
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

type FormData = z.infer<typeof CreatePostSchema>;

export function PostForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const { data: record, isLoading } = usePost(id || '');
  const createMutation = useCreatePost();
  const updateMutation = useUpdatePost();

  // Fetch relations
  const { data: users } = useUsers();

  const form = useForm<FormData>({
    resolver: zodResolver(CreatePostSchema),
  });

  useEffect(() => {
    if (record) {
      form.reset(record);
    }
  }, [record, form]);

  const onSubmit = (data: FormData) => {
    if (isEdit && id) {
      updateMutation.mutate({ id, data }, {
        onSuccess: () => navigate('/posts')
      });
    } else {
      createMutation.mutate(data, {
        onSuccess: () => navigate('/posts')
      });
    }
  };

  if (isEdit && isLoading) return <div>Loading...</div>;

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-2xl font-bold mb-6">{isEdit ? 'Edit' : 'Create'} Post</h2>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        
        <div className="space-y-2">
          <Label htmlFor="title">title</Label>
          <Input id="title" {...form.register('title')} />
          {form.formState.errors.title && <p className="text-sm text-red-500">{form.formState.errors.title?.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="content">content</Label>
          <Input id="content" {...form.register('content')} />
          {form.formState.errors.content && <p className="text-sm text-red-500">{form.formState.errors.content?.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="published">published</Label>
          <Input id="published" {...form.register('published')} />
          {form.formState.errors.published && <p className="text-sm text-red-500">{form.formState.errors.published?.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="authorId">author</Label>
          <Select onValueChange={(value) => form.setValue('authorId', value)} defaultValue={record?.authorId}>
            <SelectTrigger>
              <SelectValue placeholder="Select User" />
            </SelectTrigger>
            <SelectContent>
              {users?.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name || item.title || item.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.authorId && <p className="text-sm text-red-500">{form.formState.errors.authorId?.message}</p>}
        </div>
        
        < div className="flex gap-2" >
            <Button type="submit" disabled = { createMutation.isPending || updateMutation.isPending } >
                { isEdit? 'Update': 'Create' }
                </Button>
                < Button type="button" variant="outline" onClick={() => navigate('/posts')
        } >
            Cancel
            </Button>
            </div>
            </form>
            </div>
        );
    }
