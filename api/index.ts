import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initDatabase } from '../backend/src/database/db.js';
import { apiRouter } from '../backend/src/routes/api.js';

const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

let isDbReady = false;
app.use(async (_req, _res, next) => {
  if (!isDbReady) {
    try {
      await initDatabase();
      isDbReady = true;
    } catch (err) {
      console.error('[VERCEL API] Erro ao inicializar SQLite:', err);
    }
  }
  next();
});

// Suporta tanto requisições para /api/... quanto direto na raiz da Serverless Function
app.use('/api', apiRouter);
app.use('/', apiRouter);

export default app;
