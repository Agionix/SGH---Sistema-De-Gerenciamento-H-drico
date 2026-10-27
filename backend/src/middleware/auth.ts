import { Request, Response, NextFunction } from 'express';
import { validateSession, SessionData } from '../utils/security.js';

// Estende a interface Request do Express para incluir o usuário autenticado
declare global {
  namespace Express {
    interface Request {
      user?: SessionData;
    }
  }
}

/**
 * Middleware para proteção obrigatória de endpoints privados
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Busca o token no cookie seguro ou no header Authorization Bearer
  let token: string | undefined = req.cookies?.sgh_session;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    res.status(401).json({
      sucesso: false,
      erro: 'Acesso não autorizado. Faça login para continuar.',
      codigo: 'UNAUTHORIZED'
    });
    return;
  }

  const session = validateSession(token);
  if (!session) {
    res.status(401).json({
      sucesso: false,
      erro: 'Sessão não encontrada. Faça login para continuar.',
      codigo: 'UNAUTHORIZED'
    });
    return;
  }

  req.user = session;
  next();
}
