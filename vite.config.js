import { defineConfig } from 'vite';

export default defineConfig({
  // Base URL for GitHub Pages deployment
  base: '/screencast/',
  
  server: {
    // Open browser on dev start
    open: true,
    // Allow connections from other devices on same network (for testing)
    host: true,
  },
  
  build: {
    // Output directory
    outDir: 'dist',
    // Generate sourcemaps for debugging
    sourcemap: false,
    // Minify for production
    minify: true,
  },
});
