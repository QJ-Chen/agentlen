// Single source of truth for the backend base URL. The FastAPI server binds
// to 8080 by default; override with VITE_API_URL when running it elsewhere.
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
