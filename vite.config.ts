import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // This ensures process.env.API_KEY is available in the client code.
    // We are hardcoding the provided key here to ensure it works in the client environment.
    'process.env.API_KEY': JSON.stringify("AIzaSyBHb0P0KmJTJ3QH37yPG0FBlEr_7aR9tpM"),
    // Also expose it via import.meta.env for standard Vite patterns if needed
    'import.meta.env.VITE_API_KEY': JSON.stringify("AIzaSyBHb0P0KmJTJ3QH37yPG0FBlEr_7aR9tpM"),
  },
  server: {
    host: '0.0.0.0',
    port: 8080,
  },
  preview: {
    host: '0.0.0.0',
    port: process.env.PORT ? Number(process.env.PORT) : 8080,
    allowedHosts: true,
  },
})