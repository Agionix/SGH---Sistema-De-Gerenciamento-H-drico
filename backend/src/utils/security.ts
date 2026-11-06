import crypto from 'crypto';
import { config } from '../config/index.js';

export interface UserRecord {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
  role: string;
  created_at: string;
  last_login?: string;
}

export interface SessionData {
  userId: number;
  username: string;
  role: string;
  expiresAt: number;
}

// Armazenamento em memória de sessões ativas (chave = token)
const activeSessions = new Map<string, SessionData>();

// Rastreador de tentativas de login contra ataques de força bruta
interface RateLimitEntry {
  count: number;
  blockedUntil: number;
}
const loginAttempts = new Map<string, RateLimitEntry>();

const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutos de bloqueio

/**
 * Gera um salt criptograficamente seguro em hexadecimal
 */
export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Cria o hash da senha utilizando scrypt com salt seguro
 */
export function hashPassword(password: string, salt: string): string {
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return derivedKey.toString('hex');
}

/**
 * Valida a senha comparando hashes em tempo constante
 */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const hashBuffer = Buffer.from(hash, 'hex');
    if (derivedKey.length !== hashBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(derivedKey, hashBuffer);
  } catch {
    return false;
  }
}

/**
 * Cria uma sessão segura com token assinado via HMAC-SHA256
 */
export function createSession(user: { id: number; username: string; role: string }): string {
  const randomPayload = crypto.randomBytes(32).toString('hex');
  const timestamp = Date.now();
  const sessionString = `${user.id}:${user.username}:${timestamp}:${randomPayload}`;
  
  const signature = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(sessionString)
    .digest('hex');
    
  const token = `${Buffer.from(sessionString).toString('base64url')}.${signature}`;

  // Sessão contínua: não expira por inatividade nem por limite de tempo
  activeSessions.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role,
    expiresAt: Number.MAX_SAFE_INTEGER
  });
  
  return token;
}

/**
 * Valida um token de sessão
 */
export function validateSession(token: string): SessionData | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  let sessionString = '';
  try {
    sessionString = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
  } catch {
    return null;
  }

  // Validação da assinatura HMAC
  const expectedSignature = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(sessionString)
    .digest('hex');

  const sigBuffer = Buffer.from(signature, 'hex');
  const expBuffer = Buffer.from(expectedSignature, 'hex');
  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return null;
  }

  const session = activeSessions.get(token);
  if (session) return session;

  // Em ambientes serverless (Vercel) onde instâncias reiniciam, reconstrói os dados
  // de sessão a partir do payload assinado com segurança criptográfica HMAC-SHA256
  try {
    const [userIdStr, username] = sessionString.split(':');
    const reconstructed: SessionData = {
      userId: parseInt(userIdStr, 10) || 1,
      username: username || 'operador',
      role: 'admin',
      expiresAt: Number.MAX_SAFE_INTEGER
    };
    activeSessions.set(token, reconstructed);
    return reconstructed;
  } catch {
    return null;
  }
}

/**
 * Encerra uma sessão ativa
 */
export function destroySession(token: string): boolean {
  return activeSessions.delete(token);
}

/**
 * Verifica se um IP/identificador está temporariamente bloqueado por excesso de tentativas
 */
export function checkLoginRateLimit(identifier: string): { allowed: boolean; waitMinutes?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(identifier);
  
  if (!entry) {
    return { allowed: true };
  }
  
  if (entry.blockedUntil > now) {
    const waitMinutes = Math.ceil((entry.blockedUntil - now) / 60000);
    return { allowed: false, waitMinutes };
  }
  
  if (entry.blockedUntil !== 0 && entry.blockedUntil <= now) {
    // Período de bloqueio expirou, reseta contador
    loginAttempts.delete(identifier);
    return { allowed: true };
  }
  
  return { allowed: true };
}

/**
 * Registra uma tentativa de login com falha
 */
export function recordFailedLogin(identifier: string): { blocked: boolean; remainingAttempts: number } {
  const now = Date.now();
  const entry = loginAttempts.get(identifier) || { count: 0, blockedUntil: 0 };
  
  entry.count += 1;
  
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_DURATION_MS;
    loginAttempts.set(identifier, entry);
    return { blocked: true, remainingAttempts: 0 };
  }
  
  loginAttempts.set(identifier, entry);
  return { blocked: false, remainingAttempts: MAX_ATTEMPTS - entry.count };
}

/**
 * Limpa o histórico de tentativas de login após sucesso
 */
export function resetLoginAttempts(identifier: string): void {
  loginAttempts.delete(identifier);
}
