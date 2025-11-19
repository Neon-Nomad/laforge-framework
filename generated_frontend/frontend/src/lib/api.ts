
import axios from 'axios';

export const api = axios.create({
    baseURL: '/api', // Proxy handled by Vite or configured elsewhere
});

api.interceptors.response.use(
    (response) => response.data,
    (error) => {
        // Handle global errors (401, 403, etc.)
        return Promise.reject(error);
    }
);
