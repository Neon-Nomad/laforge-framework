
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { User, CreateUser, UpdateUser, Post, CreatePost, UpdatePost } from './schemas';


// --- User ---
export const useUsers = () => {
    return useQuery < User [] > ({
        queryKey: ['Users'],
        queryFn: () => api.get('/users')
    });
};

export const useUser = (id: string) => {
    return useQuery < User> ({
        queryKey: ['Users', id],
        queryFn: () => api.get(`/users/${id}`),
                        enabled: !!id
                    });
                };

export const useCreateUser = () => {
  const queryClient = useQueryClient();
  return useMutation<User, Error, CreateUser>({
    mutationFn: (data) => api.post('/users', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['Users'] });
    }
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  return useMutation<User, Error, { id: string, data: UpdateUser }>({
    mutationFn: ({ id, data }) => api.patch(`/users/${id}`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['Users'] });
      queryClient.invalidateQueries({ queryKey: ['Users', data.id] });
    }
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['Users'] });
    }
  });
};


// --- Post ---
export const usePosts = () => {
    return useQuery < Post [] > ({
        queryKey: ['Posts'],
        queryFn: () => api.get('/posts')
    });
};

export const usePost = (id: string) => {
    return useQuery < Post> ({
        queryKey: ['Posts', id],
        queryFn: () => api.get(`/posts/${id}`),
                        enabled: !!id
                    });
                };

export const useCreatePost = () => {
  const queryClient = useQueryClient();
  return useMutation<Post, Error, CreatePost>({
    mutationFn: (data) => api.post('/posts', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['Posts'] });
    }
  });
};

export const useUpdatePost = () => {
  const queryClient = useQueryClient();
  return useMutation<Post, Error, { id: string, data: UpdatePost }>({
    mutationFn: ({ id, data }) => api.patch(`/posts/${id}`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['Posts'] });
      queryClient.invalidateQueries({ queryKey: ['Posts', data.id] });
    }
  });
};

export const useDeletePost = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/posts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['Posts'] });
    }
  });
};

