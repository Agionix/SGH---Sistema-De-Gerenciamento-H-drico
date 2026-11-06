import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { config } from './backend/src/config/index.js';
import { initDatabase, persistDatabase } from './backend/src/database/db.js';
import { apiRouter } from './backend/src/routes/api.js';
import { serialService } from './backend/src/services/serialService.js';

async function bootstrap() {
  const app = express();

  // Permite que o Express identifique HTTPS e cabeçalhos de proxy reverso (Cloud Run / Nginx)
  app.set('trust proxy', 1);

  // Inicializa o banco de dados SQLite e tabelas essenciais
  console.log('[SGH] Inicializando banco de dados SQLite...');
  await initDatabase();
  console.log('[SGH] Banco de dados SQLite pronto para persistência offline.');

  // Middlewares essenciais
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(express.text({ type: ['text/*', 'application/text'] }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Rota de API REST
  app.use('/api', apiRouter);

  // Serve arquivos estáticos da pasta frontend diretamente
  const frontendDir = path.resolve(process.cwd(), 'frontend');
  app.use(express.static(frontendDir));

  // Redirecionamento da raiz para a tela de login
  app.get('/', (_req, res) => {
    res.redirect('/login.html');
  });

  // Integração com Vite em desenvolvimento (quando aplicável)
  if (process.env.NODE_ENV !== 'production') {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'custom'
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('[SGH] Vite middleware não inicializado, servindo estáticos padrão:', err);
    }
  }

  // Inicialização do hardware serial (Arduino & ESP32)
  if (config.serialAutoConnect) {
    serialService.autoDetectAndConnect().then((result) => {
      if (result.sucesso) {
        console.log(`[SGH] Dispositivo serial conectado automaticamente: ${result.mensagem}`);
      } else {
        console.log(`[SGH] Servidor iniciado. Nenhuma porta USB física no servidor (${result.mensagem}).`);
        console.log('[SGH] Telemetria pronta para Web Serial (navegador) ou Wi-Fi (POST /api/telemetria/leitura).');
      }
    }).catch(() => {
      console.log('[SGH] Pronto para receber telemetria via Web Serial ou Wi-Fi.');
    });
  }

  // Encerramento limpo e seguro
  const shutdown = () => {
    console.log('\n[SGH] Encerrando servidor e salvando dados...');
    serialService.disconnect();
    persistDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  app.listen(config.port, '0.0.0.0', () => {
    console.log('================================================================');
    console.log(' SGH — SISTEMA DE GERENCIAMENTO HIDRÁULICO');
    console.log(' 100% OFFLINE — MONITORAMENTO INDUSTRIAL E RESIDENCIAL');
    console.log(` Servidor em execução: http://localhost:${config.port}`);
    console.log(` Acesso direto ao Login: http://localhost:${config.port}/login.html`);
    console.log(` Acesso ao Dashboard: http://localhost:${config.port}/dashboard.html`);
    console.log('================================================================');
  });
}

bootstrap().catch((err) => {
  console.error('[SGH] Erro fatal na inicialização do servidor:', err);
  process.exit(1);
});
