import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initDatabase } from '../backend/src/database/db.js';
import { apiRouter } from '../backend/src/routes/api.js';

const app = express();

// Suporte a cabeçalhos de proxy e protocolo HTTPS da Vercel
app.set('trust proxy', 1);

// Middlewares padrão
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.text({ type: ['text/*', 'application/text'] }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Inicialização segura e resiliente do SQLite na inicialização serverless
let dbInitPromise: Promise<any> | null = null;
function getDatabase() {
  if (!dbInitPromise) {
    dbInitPromise = initDatabase().catch((err) => {
      console.error('[VERCEL-API] Falha ao inicializar SQLite:', err);
      dbInitPromise = null;
      throw err;
    });
  }
  return dbInitPromise;
}

// Assegura que o banco está pronto antes de processar qualquer requisição
app.use(async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    await getDatabase();
    next();
  } catch (err: any) {
    _res.status(500).json({
      sucesso: false,
      erro: `Erro na base de dados SQLite: ${err.message}`
    });
  }
});

// Suporte duplo a roteamento:
// Na Vercel, req.url pode chegar preservando o prefixo '/api' ou sem ele dependendo do rewrite
app.use('/api', apiRouter);
app.use('/', apiRouter);

// Resposta 404 em JSON limpo caso nenhuma rota de API seja correspondida
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    sucesso: false,
    erro: 'Endpoint de API não encontrado no SGH.'
  });
});

// Exporta como padrão tanto para compatibilidade com @vercel/node Express handler
export default app;
