
const z = require("zod").z;


export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  isActive: z.boolean(),
});

export const CreateUserSchema = z.object({
  email: z.string(),
  name: z.string(),
  role: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const UpdateUserSchema = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;


export const PostSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  published: z.boolean(),
  authorId: z.string().uuid(),
});

export const CreatePostSchema = z.object({
  title: z.string(),
  content: z.string(),
  published: z.boolean().optional(),
  authorId: z.string().uuid(),
});

export const UpdatePostSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  published: z.boolean().optional(),
  authorId: z.string().uuid().optional(),
});

export type Post = z.infer<typeof PostSchema>;
export type CreatePost = z.infer<typeof CreatePostSchema>;
export type UpdatePost = z.infer<typeof UpdatePostSchema>;

