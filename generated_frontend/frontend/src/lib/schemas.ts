import { z } from 'zod';


export const UserSchema = z.object({
      id: z.string().uuid(), 
  email: z.string(), 
  name: z.string(), 
  role: z.string(), 
  isActive: z.boolean(), 
});

export const CreateUserSchema = UserSchema.omit({ id: true, createdAt: true, updatedAt: true });
export const UpdateUserSchema = UserSchema.partial().omit({ id: true, createdAt: true, updatedAt: true });

export type User = z.infer < typeof UserSchema>;
export type CreateUser = z.infer < typeof CreateUserSchema>;
export type UpdateUser = z.infer < typeof UpdateUserSchema>;


export const PostSchema = z.object({
      id: z.string().uuid(), 
  title: z.string(), 
  content: z.string(), 
  published: z.boolean(), 
  authorId: z.string().uuid(), 
});

export const CreatePostSchema = PostSchema.omit({ id: true, createdAt: true, updatedAt: true });
export const UpdatePostSchema = PostSchema.partial().omit({ id: true, createdAt: true, updatedAt: true });

export type Post = z.infer < typeof PostSchema>;
export type CreatePost = z.infer < typeof CreatePostSchema>;
export type UpdatePost = z.infer < typeof UpdatePostSchema>;

