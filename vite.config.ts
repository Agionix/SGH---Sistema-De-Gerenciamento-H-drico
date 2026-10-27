import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function copyFrontendPlugin(): Plugin {
  return {
    name: 'copy-frontend',
    closeBundle() {
      const srcDir = path.resolve(__dirname, 'frontend');
      const destDir = path.resolve(__dirname, 'dist');
      if (fs.existsSync(srcDir) && fs.existsSync(destDir)) {
        fs.cpSync(srcDir, destDir, { recursive: true });
        // Copia login.html para index.html no dist para acesso imediato e sem redirecionamentos na raiz
        const loginPath = path.resolve(destDir, 'login.html');
        const indexPath = path.resolve(destDir, 'index.html');
        if (fs.existsSync(loginPath)) {
          fs.copyFileSync(loginPath, indexPath);
        }
        console.log('[build] Arquivos do frontend copiados para dist/ e dist/index.html sincronizado.');
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), copyFrontendPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
