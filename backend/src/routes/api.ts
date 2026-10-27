import { Router, Request, Response } from 'express';
import { queryOne, queryAll, run, createBackup } from '../database/db.js';
import {
  generateSalt,
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  destroySession,
  checkLoginRateLimit,
  recordFailedLogin,
  resetLoginAttempts
} from '../utils/security.js';
import { config } from '../config/index.js';
import { requireAuth } from '../middleware/auth.js';
import { serialService } from '../services/serialService.js';
import { simulationService, SimulationScenario } from '../services/simulationService.js';
import { leakDetector } from '../services/leakDetector.js';
import { litersToCubicMeters, calculateCost } from '../utils/hydraulic.js';

export const apiRouter = Router();

// ==============================================================================
// ENDPOINTS PÚBLICOS
// ==============================================================================

/**
 * GET /api/saude — Diagnóstico do servidor e estado da aplicação
 */
apiRouter.get('/saude', (_req: Request, res: Response) => {
  const serialStatus = serialService.getStatus();
  res.json({
    sucesso: true,
    sistema: 'SGH — Sistema de Gerenciamento Hidráulico',
    status: 'operacional',
    timestamp: new Date().toISOString(),
    uptimeSegundos: Math.floor(process.uptime()),
    memoriaMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    modoOffline: true,
    simulacaoAtiva: simulationService.isActive(),
    serialConectado: serialStatus.connected
  });
});

/**
 * GET /api/sessao — Verifica silenciosamente se o usuário já possui sessão ativa válida
 */
apiRouter.get('/sessao', (req: Request, res: Response) => {
  let token: string | undefined = req.cookies?.sgh_session;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    res.json({ autenticado: false });
    return;
  }

  const session = validateSession(token);
  if (!session) {
    res.json({ autenticado: false });
    return;
  }

  res.json({
    autenticado: true,
    usuario: {
      id: session.userId,
      username: session.username,
      role: session.role
    }
  });
});

/**
 * POST /api/login — Autenticação de usuário com limitação de tentativas
 */
apiRouter.post('/login', (req: Request, res: Response): void => {
  const { username, password } = req.body;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown_ip';
  const rateLimitKey = `${clientIp}_${username || ''}`;

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({
      sucesso: false,
      erro: 'Nome de usuário e senha são obrigatórios.'
    });
    return;
  }

  // Verifica proteção contra força bruta
  const rateCheck = checkLoginRateLimit(rateLimitKey);
  if (!rateCheck.allowed) {
    res.status(429).json({
      sucesso: false,
      erro: `Muitas tentativas incorretas. Acesso bloqueado por segurança por mais ${rateCheck.waitMinutes} minuto(s).`
    });
    return;
  }

  // Busca usuário no banco SQLite
  const user = queryOne(
    `SELECT id, username, password_hash, salt, role FROM users WHERE username = ?`,
    [username.trim()]
  );

  if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
    const attempt = recordFailedLogin(rateLimitKey);
    const msg = attempt.blocked
      ? 'Senha incorreta. Limite excedido! Conta temporariamente bloqueada por 5 minutos.'
      : `Credenciais inválidas. Tentativas restantes antes do bloqueio: ${attempt.remainingAttempts}`;

    run(
      `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, 'AUTH', 'LOGIN_FALHOU', ?)`,
      [new Date().toISOString(), `Falha de login para o usuário: ${username}`]
    );

    res.status(401).json({
      sucesso: false,
      erro: msg
    });
    return;
  }

  // Sucesso no login: reseta limites de tentativa
  resetLoginAttempts(rateLimitKey);

  // Atualiza último login do usuário
  run(`UPDATE users SET last_login = ? WHERE id = ?`, [new Date().toISOString(), user.id]);

  // Cria token de sessão seguro
  const token = createSession({
    id: user.id,
    username: user.username,
    role: user.role
  });

  // Grava cookie HttpOnly permanente (com suporte a HTTPS e iframes)
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  res.cookie('sgh_session', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge: 365 * 24 * 60 * 60 * 1000 // 1 ano de persistência contínua
  });

  run(
    `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, 'AUTH', 'LOGIN_SUCESSO', ?)`,
    [new Date().toISOString(), `Usuário ${user.username} autenticado com sucesso`]
  );

  res.json({
    sucesso: true,
    mensagem: 'Login realizado com sucesso.',
    usuario: {
      id: user.id,
      username: user.username,
      role: user.role
    },
    token
  });
});

/**
 * POST /api/registro — Criação de nova conta de usuário
 */
apiRouter.post('/registro', (req: Request, res: Response): void => {
  const { username, password, confirmPassword } = req.body;

  if (!username || typeof username !== 'string' || !username.trim()) {
    res.status(400).json({
      sucesso: false,
      erro: 'Nome de usuário é obrigatório.'
    });
    return;
  }

  const cleanUsername = username.trim();

  if (cleanUsername.length < 3) {
    res.status(400).json({
      sucesso: false,
      erro: 'O nome de usuário deve conter pelo menos 3 caracteres.'
    });
    return;
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(cleanUsername)) {
    res.status(400).json({
      sucesso: false,
      erro: 'Nome de usuário deve conter apenas letras, números, ponto, hífen ou underline.'
    });
    return;
  }

  if (!password || typeof password !== 'string' || password.length < 4) {
    res.status(400).json({
      sucesso: false,
      erro: 'A senha deve conter no mínimo 4 caracteres.'
    });
    return;
  }

  if (confirmPassword !== undefined && password !== confirmPassword) {
    res.status(400).json({
      sucesso: false,
      erro: 'A confirmação de senha não confere com a senha digitada.'
    });
    return;
  }

  // Verifica se o usuário já existe no banco
  const existingUser = queryOne(
    `SELECT id FROM users WHERE LOWER(username) = LOWER(?)`,
    [cleanUsername]
  );

  if (existingUser) {
    res.status(409).json({
      sucesso: false,
      erro: 'Este nome de usuário já está em uso. Por favor, escolha outro.'
    });
    return;
  }

  // Gera salt e hash scrypt
  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);
  const now = new Date().toISOString();

  // Insere novo usuário no SQLite com perfil 'operador'
  run(
    `INSERT INTO users (username, password_hash, salt, role, created_at, last_login)
     VALUES (?, ?, ?, 'operador', ?, ?)`,
    [cleanUsername, passwordHash, salt, now, now]
  );

  // Busca o usuário recém-criado para obter o ID
  const newUser = queryOne<{ id: number; username: string; role: string }>(
    `SELECT id, username, role FROM users WHERE username = ?`,
    [cleanUsername]
  );

  if (!newUser) {
    res.status(500).json({
      sucesso: false,
      erro: 'Erro interno ao salvar novo usuário.'
    });
    return;
  }

  // Cria sessão e faz login automático
  const token = createSession({
    id: newUser.id,
    username: newUser.username,
    role: newUser.role
  });

  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  res.cookie('sgh_session', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge: 365 * 24 * 60 * 60 * 1000 // 1 ano de persistência contínua
  });

  run(
    `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, 'AUTH', 'NOVO_CADASTRO', ?)`,
    [now, `Novo usuário cadastrado: ${newUser.username} (perfil: ${newUser.role})`]
  );

  res.status(201).json({
    sucesso: true,
    mensagem: 'Conta criada com sucesso!',
    usuario: {
      id: newUser.id,
      username: newUser.username,
      role: newUser.role
    },
    token
  });
});

/**
 * POST /api/demo-login — Acesso instantâneo ao Modo Demonstração & Simulação sem credenciais
 */
apiRouter.post('/demo-login', (req: Request, res: Response): void => {
  // Garante que o motor de simulação esteja em execução com vazão ativa (cenário torneira/chuveiro)
  if (!simulationService.isActive()) {
    simulationService.start('torneira');
  }

  // Se o banco estiver sem leituras ou com poucas amostras, gera histórico inicial para o gráfico
  try {
    const totalLeituras = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM leituras`)?.count || 0;
    if (totalLeituras < 10) {
      const now = Date.now();
      const tariffM3 = Number(queryOne(`SELECT valor FROM configuracoes WHERE chave = 'tarifa_m3'`)?.valor || 4.50);
      let cumulative = 12.5;

      for (let i = 15; i >= 1; i--) {
        const timePoint = new Date(now - i * 3000).toISOString();
        const flow = Number((4.3 + Math.random() * 0.8).toFixed(2));
        const deltaSeconds = 3.0;
        const incrementalLiters = Number(((flow / 60.0) * deltaSeconds).toFixed(3));
        cumulative += incrementalLiters;
        const m3Incremental = litersToCubicMeters(incrementalLiters);
        const custoIncremental = calculateCost(m3Incremental, tariffM3);
        const m3Total = litersToCubicMeters(cumulative);
        const custoAcumulado = calculateCost(m3Total, tariffM3);

        run(
          `INSERT INTO leituras (
            timestamp, vazao_lmin, litros_incrementais, litros_acumulados,
            custo_incremental, custo_acumulado, status, origem
          ) VALUES (?, ?, ?, ?, ?, ?, 'normal', 'simulado')`,
          [timePoint, flow, incrementalLiters, Number(cumulative.toFixed(2)), custoIncremental, custoAcumulado]
        );
      }
    }

    // Se não houver alertas, insere um exemplo de alerta resolvido no histórico para demonstração
    const totalAlertas = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM alertas`)?.count || 0;
    if (totalAlertas === 0) {
      const sampleTime = new Date(Date.now() - 3600000).toISOString();
      const resolvedTime = new Date(Date.now() - 3400000).toISOString();
      run(
        `INSERT INTO alertas (timestamp, tipo, severidade, descricao, status, valor_detectado, resolvido_em)
         VALUES (?, 'VAZAMENTO_CONTINUO', 'media', 'Demonstração: Detecção de fluxo contínuo durante a madrugada', 'resolvido', '1.2 L/min', ?)`,
        [sampleTime, resolvedTime]
      );
    }
  } catch (err) {
    console.warn('[DEMO] Aviso ao semear dados iniciais de simulação:', err);
  }

  // Gera uma sessão segura com papel 'demo'
  const demoUser = {
    id: 9999,
    username: 'Visitante (Demo)',
    role: 'demo'
  };

  const token = createSession(demoUser);

  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  res.cookie('sgh_session', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 dias
  });

  try {
    run(
      `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, 'AUTH', 'DEMO_LOGIN', ?)`,
      [new Date().toISOString(), 'Acesso direto concedido via Modo Demonstração & Simulação']
    );
  } catch {}

  res.json({
    sucesso: true,
    mensagem: 'Modo Demonstração ativado com sucesso!',
    usuario: demoUser,
    token,
    modoDemo: true,
    cenario: simulationService.getScenario()
  });
});

// Código temporário de recuperação em memória
let activeRecoveryCode: { codigo: string; expiraEm: number } = {
  codigo: '839204',
  expiraEm: Date.now() + 15 * 60 * 1000
};

/**
 * GET /api/recuperar-conta/codigo — Fornece ou gera um código de recuperação imediato
 */
apiRouter.get('/recuperar-conta/codigo', (_req: Request, res: Response) => {
  const now = Date.now();
  if (!activeRecoveryCode || now > activeRecoveryCode.expiraEm) {
    const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
    activeRecoveryCode = {
      codigo: randomCode,
      expiraEm: now + 15 * 60 * 1000 // 15 minutos de validade
    };
  }

  const expiraEmSegundos = Math.max(0, Math.round((activeRecoveryCode.expiraEm - now) / 1000));

  res.json({
    sucesso: true,
    codigo: activeRecoveryCode.codigo,
    pinPadrao: '1234',
    expiraEmSegundos,
    mensagem: 'Código de recuperação gerado com sucesso.'
  });
});

/**
 * POST /api/recuperar-conta — Redefinição de senha facilitada (Código de 6 dígitos, PIN 1234 ou Chave Mestra)
 */
apiRouter.post('/recuperar-conta', (req: Request, res: Response): void => {
  const { username, recoveryKey, codigo, pin, codigoSeguranca, newPassword, confirmPassword } = req.body;
  const suppliedCode = String(codigo || pin || codigoSeguranca || recoveryKey || '').trim();

  if (!username || typeof username !== 'string' || !username.trim()) {
    res.status(400).json({ sucesso: false, erro: 'Informe o nome de usuário que deseja recuperar.' });
    return;
  }

  const cleanUsername = username.trim();

  if (!suppliedCode) {
    res.status(400).json({ sucesso: false, erro: 'Informe o código de segurança de 6 dígitos ou o PIN 1234.' });
    return;
  }

  // Validação: aceita o código temporário ativo, o PIN padrão 1234 ou a chave mestra
  const isCodeValid = (activeRecoveryCode && suppliedCode === activeRecoveryCode.codigo && Date.now() <= activeRecoveryCode.expiraEm);
  const isPinValid = (suppliedCode === '1234');
  const isMasterKeyValid = (suppliedCode === config.masterRecoveryKey);

  if (!isCodeValid && !isPinValid && !isMasterKeyValid) {
    run(
      `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, 'SEGURANCA', 'FALHA_RECUPERACAO', ?)`,
      [new Date().toISOString(), `Tentativa inválida de recuperação com código incorreto para: ${cleanUsername}`]
    );
    res.status(401).json({
      sucesso: false,
      erro: 'Código ou PIN de recuperação incorreto. Use o código exibido na tela ou o PIN padrão 1234.'
    });
    return;
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
    res.status(400).json({ sucesso: false, erro: 'A nova senha deve conter no mínimo 4 caracteres.' });
    return;
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    res.status(400).json({ sucesso: false, erro: 'A confirmação de senha não confere com a nova senha digitada.' });
    return;
  }

  // Localiza o usuário no SQLite
  const user = queryOne<{ id: number; username: string; role: string }>(
    `SELECT id, username, role FROM users WHERE LOWER(username) = LOWER(?)`,
    [cleanUsername]
  );

  if (!user) {
    res.status(404).json({
      sucesso: false,
      erro: `Usuário '${cleanUsername}' não encontrado no banco de dados local.`
    });
    return;
  }

  // Gera novo salt e hash criptográfico seguro via scrypt
  const salt = generateSalt();
  const passwordHash = hashPassword(newPassword, salt);
  const now = new Date().toISOString();

  // Atualiza as credenciais no SQLite
  run(
    `UPDATE users SET password_hash = ?, salt = ?, last_login = ? WHERE id = ?`,
    [passwordHash, salt, now, user.id]
  );

  // Registra auditoria de segurança
  run(
    `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, 'AUTH', 'SENHA_REDEFINIDA', ?)`,
    [now, `Senha do usuário ${user.username} redefinida com sucesso via chave de recuperação`]
  );

  // Cria nova sessão autenticada e grava cookie
  const token = createSession({
    id: user.id,
    username: user.username,
    role: user.role
  });

  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  res.cookie('sgh_session', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge: 365 * 24 * 60 * 60 * 1000
  });

  res.json({
    sucesso: true,
    mensagem: 'Senha redefinida com sucesso! Você já está autenticado.',
    usuario: {
      id: user.id,
      username: user.username,
      role: user.role
    },
    token
  });
});

/**
 * POST /api/logout — Encerramento da sessão
 */
apiRouter.post('/logout', (req: Request, res: Response) => {
  let token = req.cookies?.sgh_session;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (token) {
    destroySession(token);
  }

  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  res.clearCookie('sgh_session', {
    path: '/',
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax'
  });

  res.json({
    sucesso: true,
    mensagem: 'Sessão encerrada com sucesso.'
  });
});

// ==============================================================================
// ENDPOINTS DE HARDWARE E COMUNICAÇÃO SERIAL (PÚBLICOS - FORA DO DASHBOARD)
// Permite detecção, pareamento e testes com Arduino / ESP32 sem exigir login
// ==============================================================================

/**
 * GET /api/serial/portas & GET /api/serial/dispositivos
 */
apiRouter.get('/serial/portas', async (_req: Request, res: Response) => {
  const dispositivos = await serialService.listAvailablePorts();
  const status = serialService.getStatus();
  res.json({
    sucesso: true,
    portaAtual: status.portPath,
    conectado: status.connected,
    dispositivoAtual: status.dispositivoAtual,
    tipoDetectado: status.tipoDetectado,
    portas: dispositivos,
    dispositivos
  });
});

apiRouter.get('/serial/dispositivos', async (_req: Request, res: Response) => {
  const dispositivos = await serialService.listAvailablePorts();
  const status = serialService.getStatus();
  res.json({
    sucesso: true,
    dispositivoAtual: status.dispositivoAtual,
    tipoDetectado: status.tipoDetectado,
    conectado: status.connected,
    portaAtual: status.portPath,
    baudRate: status.baudRate,
    dispositivos
  });
});

/**
 * GET /api/serial/status — Consulta status de conexão e leituras ao vivo
 */
apiRouter.get('/serial/status', (_req: Request, res: Response) => {
  const status = serialService.getStatus();
  res.json({
    sucesso: true,
    dados: status
  });
});

/**
 * POST /api/serial/autodetectar — Plug & Play: varre portas USB e conecta automaticamente
 */
apiRouter.post('/serial/autodetectar', async (_req: Request, res: Response) => {
  if (simulationService.isActive()) {
    simulationService.stop();
  }

  const result = await serialService.autoDetectAndConnect();
  res.json({
    sucesso: result.sucesso,
    mensagem: result.mensagem,
    dispositivo: result.dispositivo
  });
});

/**
 * POST /api/serial/conectar — Conecta a uma porta serial e taxa baud específica
 */
apiRouter.post('/serial/conectar', (req: Request, res: Response): void => {
  const { porta, baudRate } = req.body;
  if (!porta || typeof porta !== 'string') {
    res.status(400).json({ sucesso: false, erro: 'Nome da porta serial é obrigatório.' });
    return;
  }

  if (simulationService.isActive()) {
    simulationService.stop();
  }

  const baud = baudRate ? parseInt(String(baudRate), 10) : config.serialBaudrate;
  const ok = serialService.connect(porta.trim(), isNaN(baud) ? 115200 : baud);

  // Persiste a porta escolhida nas configurações do SQLite
  try {
    const now = new Date().toISOString();
    run(`UPDATE configuracoes SET valor = ?, updated_at = ? WHERE chave = 'porta_serial'`, [porta.trim(), now]);
    if (baudRate) {
      run(`UPDATE configuracoes SET valor = ?, updated_at = ? WHERE chave = 'taxa_transmissao'`, [String(baud), now]);
    }
  } catch (err) {
    console.warn('Erro ao persistir porta serial no banco:', err);
  }

  res.json({
    sucesso: ok,
    mensagem: ok
      ? `Conectado com sucesso à porta ${porta} (${isNaN(baud) ? 115200 : baud} bps)!`
      : `Falha ao abrir porta ${porta}. Verifique se o cabo USB do Arduino/ESP32 está conectado.`
  });
});

/**
 * POST /api/serial/desconectar
 */
apiRouter.post('/serial/desconectar', (_req: Request, res: Response) => {
  serialService.disconnect();
  res.json({
    sucesso: true,
    mensagem: 'Porta serial desconectada com sucesso.'
  });
});

/**
 * POST /api/telemetria/leitura — Recebe telemetria de hardware (via Web Serial do navegador ou ESP32)
 */
apiRouter.post('/telemetria/leitura', (req: Request, res: Response): void => {
  const { vazao_lmin, litros_totais, status, dispositivo, linha_bruta } = req.body;

  let rawString = '';
  if (linha_bruta && typeof linha_bruta === 'string') {
    rawString = linha_bruta.trim();
  } else if (vazao_lmin !== undefined && litros_totais !== undefined) {
    rawString = JSON.stringify({
      vazao_lmin: Number(vazao_lmin),
      litros_totais: Number(litros_totais),
      status: status || 'normal',
      dispositivo: dispositivo || 'esp32'
    });
  }

  if (!rawString) {
    res.status(400).json({
      sucesso: false,
      erro: 'Dados de telemetria inválidos. Envie { vazao_lmin, litros_totais } ou { linha_bruta }.'
    });
    return;
  }

  // Interrompe simulação quando dados de hardware real são recebidos
  if (simulationService.isActive()) {
    simulationService.stop();
  }

  const ok = serialService.handleIncomingLine(rawString);
  const statusInfo = serialService.getStatus();

  res.json({
    sucesso: ok,
    mensagem: ok ? 'Telemetria gravada com sucesso.' : 'Formato de telemetria não reconhecido.',
    dados: {
      vazao_lmin: statusInfo.lastFlowLmin,
      litros_totais: statusInfo.lastTotalLiters,
      custo_acumulado: statusInfo.totalCostEstimated,
      ultima_leitura: statusInfo.lastReadingTime,
      conectado: true
    }
  });
});

// ==============================================================================
// ENDPOINTS PROTEGIDOS (EXIGEM AUTENTICAÇÃO)
// ==============================================================================
apiRouter.use(requireAuth);

/**
 * GET /api/status — Retorna os dados em tempo real da vazão, consumo, custo e conexão
 */
apiRouter.get('/status', (req: Request, res: Response) => {
  const isSimulating = simulationService.isActive();
  const serialStatus = serialService.getStatus();
  const tariffM3 = Number(queryOne(`SELECT valor FROM configuracoes WHERE chave = 'tarifa_m3'`)?.valor || 4.50);

  let currentFlow = 0;
  let totalLiters = 0;
  let totalCost = 0;
  let lastReadingTime: string | null = null;
  let connectionState = 'desconectado';
  let sensorHealth = 'desconectado';

  if (isSimulating) {
    const sim = simulationService.getCurrentStatus();
    currentFlow = sim.flowLmin;
    totalLiters = sim.totalLiters;
    totalCost = sim.totalCostEstimated;
    lastReadingTime = sim.lastReadingTime;
    connectionState = 'simulacao';
    sensorHealth = currentFlow > 30 ? 'atencao' : 'normal';
  } else {
    currentFlow = serialStatus.lastFlowLmin;
    totalLiters = serialStatus.lastTotalLiters;
    totalCost = serialStatus.totalCostEstimated;
    lastReadingTime = serialStatus.lastReadingTime;
    connectionState = serialStatus.connected ? 'conectado' : 'desconectado';
    sensorHealth = leakDetector.checkSensorHealth(serialStatus.connected);
  }

  // Verifica se há alertas ativos
  const activeAlertsCount = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM alertas WHERE status = 'ativo'`
  )?.count || 0;

  // Consumo do dia atual
  const todayIsoPrefix = new Date().toISOString().slice(0, 10);
  const todayLiters = queryOne<{ soma: number }>(
    `SELECT SUM(litros_incrementais) as soma FROM leituras WHERE timestamp LIKE ?`,
    [`${todayIsoPrefix}%`]
  )?.soma || 0;

  const todayM3 = litersToCubicMeters(todayLiters);
  const todayCost = calculateCost(todayM3, tariffM3);

  // Status visual consolidado
  let statusBadge = 'Normal';
  if (sensorHealth === 'desconectado') {
    statusBadge = 'Sensor desconectado';
  } else if (activeAlertsCount > 0) {
    statusBadge = 'Atenção';
  } else if (currentFlow > 25) {
    statusBadge = 'Fluxo Elevado';
  }

  // Identificação amigável do dispositivo conectado
  const dispositivoNome = isSimulating
    ? 'Simulador Hidráulico Ativo'
    : (serialStatus.dispositivoAtual?.nomeAmigavel || (serialStatus.tipoDetectado === 'arduino' ? 'Arduino Uno / Nano' : (serialStatus.tipoDetectado === 'esp32' ? 'ESP32 DevKit' : `Dispositivo USB (${serialStatus.portPath})`)));

  const dispositivoTipo = isSimulating
    ? 'simulado'
    : (serialStatus.tipoDetectado !== 'nenhum' ? serialStatus.tipoDetectado : (serialStatus.dispositivoAtual?.tipo || 'generico'));

  const dispositivoIcone = isSimulating
    ? 'simulacao'
    : (serialStatus.dispositivoAtual?.icone || (serialStatus.tipoDetectado === 'arduino' ? 'arduino' : (serialStatus.tipoDetectado === 'esp32' ? 'esp32' : 'usb')));

  res.json({
    sucesso: true,
    dados: {
      vazao_lmin: currentFlow,
      consumo_total_litros: totalLiters,
      consumo_total_m3: litersToCubicMeters(totalLiters),
      custo_total_reais: totalCost,
      consumo_hoje_litros: Number(todayLiters.toFixed(2)),
      consumo_hoje_m3: todayM3,
      custo_hoje_reais: todayCost,
      tarifa_aplicada_m3: tariffM3,
      conexao_serial: connectionState,
      porta_ativa: serialStatus.portPath,
      ultima_leitura: lastReadingTime,
      sensor_saude: sensorHealth,
      status_badge: statusBadge,
      alertas_ativos_count: activeAlertsCount,
      modo_simulacao: isSimulating,
      cenario_simulacao: simulationService.getScenario(),
      usuario_conectado: req.user?.username,
      dispositivo_nome: dispositivoNome,
      dispositivo_tipo: dispositivoTipo,
      dispositivo_icone: dispositivoIcone,
      dispositivo_conectado: isSimulating ? true : serialStatus.connected,
      taxa_transmissao: serialStatus.baudRate,
      dispositivos_detectados_count: serialStatus.dispositivosDisponiveis?.length || 0
    }
  });
});

/**
 * GET /api/historico — Consulta leituras históricas com filtros e paginação
 */
apiRouter.get('/historico', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limit = Math.min(100, Math.max(5, parseInt(req.query.limit as string || '20', 10)));
  const offset = (page - 1) * limit;
  const periodo = (req.query.periodo as string) || 'hoje'; // hoje, 7dias, todos

  let whereClause = '';
  const params: any[] = [];

  if (periodo === 'hoje') {
    const today = new Date().toISOString().slice(0, 10);
    whereClause = 'WHERE timestamp LIKE ?';
    params.push(`${today}%`);
  } else if (periodo === '7dias') {
    whereClause = "WHERE datetime(timestamp) >= datetime('now', '-7 days')";
  }

  const countQuery = `SELECT COUNT(*) as total FROM leituras ${whereClause}`;
  const totalRows = queryOne<{ total: number }>(countQuery, params)?.total || 0;

  const dataQuery = `
    SELECT id, timestamp, vazao_lmin, litros_incrementais, litros_acumulados,
           custo_incremental, custo_acumulado, status, origem
    FROM leituras
    ${whereClause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = queryAll(dataQuery, [...params, limit, offset]);

  // Formata os dados para exibição na tabela do frontend
  const itens = rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    vazao_lmin: r.vazao_lmin,
    litros_incrementais: Number(r.litros_incrementais.toFixed(3)),
    m3_incrementais: litersToCubicMeters(r.litros_incrementais),
    litros_acumulados: Number(r.litros_acumulados.toFixed(2)),
    m3_acumulados: litersToCubicMeters(r.litros_acumulados),
    custo_estimado: Number(r.custo_acumulado.toFixed(2)),
    status: r.status,
    origem: r.origem
  }));

  res.json({
    sucesso: true,
    dados: {
      itens,
      paginacao: {
        paginaAtual: page,
        totalPaginas: Math.ceil(totalRows / limit) || 1,
        totalRegistros: totalRows,
        limitePorPagina: limit
      }
    }
  });
});

/**
 * GET /api/alertas — Consulta alertas ativos e histórico de incidentes
 */
apiRouter.get('/alertas', (_req: Request, res: Response) => {
  const alertasAtivos = queryAll(
    `SELECT id, timestamp, tipo, severidade, descricao, status, valor_detectado
     FROM alertas
     WHERE status = 'ativo'
     ORDER BY id DESC`
  );

  const historicoAlertas = queryAll(
    `SELECT id, timestamp, tipo, severidade, descricao, status, valor_detectado, resolvido_em
     FROM alertas
     WHERE status != 'ativo'
     ORDER BY id DESC
     LIMIT 50`
  );

  res.json({
    sucesso: true,
    dados: {
      ativos: alertasAtivos,
      historico: historicoAlertas
    }
  });
});

/**
 * POST /api/alertas/:id/reconhecer — Atualiza o estado de um alerta (reconhecer ou resolver)
 */
apiRouter.post('/alertas/:id/reconhecer', (req: Request, res: Response): void => {
  const id = parseInt(req.params.id, 10);
  const { acao } = req.body; // 'reconhecido' ou 'resolvido'

  if (isNaN(id)) {
    res.status(400).json({ sucesso: false, erro: 'ID inválido' });
    return;
  }

  const novoStatus = acao === 'resolvido' ? 'resolvido' : 'reconhecido';
  const nowIso = new Date().toISOString();

  run(
    `UPDATE alertas SET status = ?, resolvido_em = ? WHERE id = ?`,
    [novoStatus, novoStatus === 'resolvido' ? nowIso : null, id]
  );

  res.json({
    sucesso: true,
    mensagem: `Alerta marcado como ${novoStatus}.`
  });
});

/**
 * POST /api/alertas/limpar-todos — Resolve ou limpa todos os alertas
 */
apiRouter.post('/alertas/limpar-todos', (req: Request, res: Response): void => {
  const { excluir } = req.body || {};
  const nowIso = new Date().toISOString();

  if (excluir) {
    run(`DELETE FROM alertas`);
  } else {
    run(`UPDATE alertas SET status = 'resolvido', resolvido_em = ? WHERE status = 'ativo'`, [nowIso]);
  }

  res.json({
    sucesso: true,
    mensagem: excluir
      ? 'Todos os alertas foram excluídos do histórico.'
      : 'Todos os alertas ativos foram marcados como resolvidos.'
  });
});

/**
 * GET /api/configuracoes — Consulta parâmetros do sistema
 */
apiRouter.get('/configuracoes', (_req: Request, res: Response) => {
  const rows = queryAll<{ chave: string; valor: string; descricao: string }>(
    `SELECT chave, valor, descricao FROM configuracoes`
  );

  const configs: Record<string, any> = {};
  for (const row of rows) {
    configs[row.chave] = row.valor;
  }

  res.json({
    sucesso: true,
    dados: configs
  });
});

/**
 * PUT /api/configuracoes — Atualiza tarifa, calibração e limites operacionais
 */
apiRouter.put('/configuracoes', (req: Request, res: Response): void => {
  const {
    tarifa_m3,
    tipo_cobranca,
    fator_calibracao,
    vazao_maxima_lmin,
    tempo_fluxo_continuo_min,
    horario_inativo_inicio,
    horario_inativo_fim,
    intervalo_leitura_ms,
    porta_serial
  } = req.body;

  // Validação de entrada
  if (tarifa_m3 !== undefined && (isNaN(Number(tarifa_m3)) || Number(tarifa_m3) < 0)) {
    res.status(400).json({ sucesso: false, erro: 'Tarifa em R$/m³ deve ser um número não-negativo.' });
    return;
  }

  if (fator_calibracao !== undefined && (isNaN(Number(fator_calibracao)) || Number(fator_calibracao) <= 0)) {
    res.status(400).json({ sucesso: false, erro: 'Fator de calibração deve ser maior que zero.' });
    return;
  }

  if (vazao_maxima_lmin !== undefined && (isNaN(Number(vazao_maxima_lmin)) || Number(vazao_maxima_lmin) <= 0)) {
    res.status(400).json({ sucesso: false, erro: 'Vazão máxima deve ser maior que zero.' });
    return;
  }

  const updates: Record<string, string> = {};
  if (tarifa_m3 !== undefined) {
    updates['tarifa_m3'] = String(Number(tarifa_m3));
    updates['tarifa_litro'] = (Number(tarifa_m3) / 1000).toFixed(5);
  }
  if (tipo_cobranca !== undefined) updates['tipo_cobranca'] = String(tipo_cobranca);
  if (fator_calibracao !== undefined) updates['fator_calibracao'] = String(Number(fator_calibracao));
  if (vazao_maxima_lmin !== undefined) updates['vazao_maxima_lmin'] = String(Number(vazao_maxima_lmin));
  if (tempo_fluxo_continuo_min !== undefined) updates['tempo_fluxo_continuo_min'] = String(Math.max(1, Number(tempo_fluxo_continuo_min)));
  if (horario_inativo_inicio !== undefined) updates['horario_inativo_inicio'] = String(horario_inativo_inicio);
  if (horario_inativo_fim !== undefined) updates['horario_inativo_fim'] = String(horario_inativo_fim);
  if (intervalo_leitura_ms !== undefined) updates['intervalo_leitura_ms'] = String(Math.max(500, Number(intervalo_leitura_ms)));
  if (porta_serial !== undefined) updates['porta_serial'] = String(porta_serial).trim();

  const now = new Date().toISOString();
  for (const [chave, valor] of Object.entries(updates)) {
    run(
      `UPDATE configuracoes SET valor = ?, updated_at = ? WHERE chave = ?`,
      [valor, now, chave]
    );
  }

  run(
    `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, 'CONFIG', 'PARAMETROS_ATUALIZADOS', ?)`,
    [now, `Configurações atualizadas pelo usuário ${req.user?.username}`]
  );

  res.json({
    sucesso: true,
    mensagem: 'Configurações atualizadas com sucesso.',
    dados: updates
  });
});

/**
 * POST /api/simulacao/toggle — Liga ou desliga o modo de simulação
 */
apiRouter.post('/simulacao/toggle', (_req: Request, res: Response) => {
  const isRunning = simulationService.toggle();
  if (isRunning) {
    serialService.disconnect();
  }
  res.json({
    sucesso: true,
    simulacaoAtiva: isRunning,
    cenario: simulationService.getScenario()
  });
});

/**
 * POST /api/simulacao/cenario — Define o perfil hidráulico na simulação
 */
apiRouter.post('/simulacao/cenario', (req: Request, res: Response): void => {
  const { cenario } = req.body;
  const validScenarios: SimulationScenario[] = ['repouso', 'torneira', 'chuveiro', 'vazamento_leve', 'ruptura_grave'];

  if (!cenario || !validScenarios.includes(cenario)) {
    res.status(400).json({
      sucesso: false,
      erro: `Cenário inválido. Escolha entre: ${validScenarios.join(', ')}`
    });
    return;
  }

  if (!simulationService.isActive()) {
    simulationService.start(cenario);
  } else {
    simulationService.setScenario(cenario);
  }

  res.json({
    sucesso: true,
    cenarioAtual: cenario,
    mensagem: `Cenário alterado para: ${cenario}`
  });
});

/**
 * POST /api/simulacao/alerta-teste — Dispara um alerta de teste em tempo real para demonstração
 */
apiRouter.post('/simulacao/alerta-teste', (req: Request, res: Response): void => {
  const { tipo } = req.body || {};
  const now = new Date().toISOString();

  let tipoAlerta = 'VAZAMENTO_CONTINUO';
  let severidade = 'media';
  let descricao = 'Simulação: Vazamento contínuo persistente detectado pelo algoritmo';
  let valor = '2.4 L/min';

  if (tipo === 'ruptura') {
    tipoAlerta = 'RUPTURA_CRITICA';
    severidade = 'critica';
    descricao = 'Simulação: Ruptura ou vazão anômala severa (>35 L/min)';
    valor = '38.2 L/min';
  } else if (tipo === 'sensor') {
    tipoAlerta = 'SENSOR_FALHA';
    severidade = 'baixa';
    descricao = 'Simulação: Interrupção temporária de sinal de telemetria';
    valor = '0 L/min';
  }

  run(
    `INSERT INTO alertas (timestamp, tipo, severidade, descricao, status, valor_detectado)
     VALUES (?, ?, ?, ?, 'ativo', ?)`,
    [now, tipoAlerta, severidade, descricao, valor]
  );

  res.json({
    sucesso: true,
    mensagem: 'Alerta de demonstração disparado com sucesso!',
    alerta: {
      timestamp: now,
      tipo: tipoAlerta,
      severidade,
      descricao,
      valor_detectado: valor,
      status: 'ativo'
    }
  });
});

/**
 * POST /api/simulacao/pulso — Injeta um pulso rápido de consumo para visualização imediata no gráfico
 */
apiRouter.post('/simulacao/pulso', (req: Request, res: Response): void => {
  const { volumeLitros } = req.body || {};
  const litros = Number(volumeLitros) > 0 ? Number(volumeLitros) : 5.0;

  // Temporariamente acelera a simulação no cenário chuveiro
  simulationService.setScenario('chuveiro');
  setTimeout(() => {
    if (simulationService.getScenario() === 'chuveiro') {
      simulationService.setScenario('torneira');
    }
  }, 6000);

  res.json({
    sucesso: true,
    mensagem: `Pulso de consumo de ${litros}L injetado na simulação!`
  });
});

/**
 * POST /api/simulacao/resetar-dados — Restaura o consumo simulado para estaca zero
 */
apiRouter.post('/simulacao/resetar-dados', (_req: Request, res: Response): void => {
  try {
    run(`DELETE FROM leituras WHERE origem = 'simulado'`);
    run(`UPDATE alertas SET status = 'resolvido', resolvido_em = ? WHERE status = 'ativo'`, [new Date().toISOString()]);
  } catch (err) {
    console.warn('Erro ao resetar dados de simulação:', err);
  }

  res.json({
    sucesso: true,
    mensagem: 'Dados de simulação resetados com sucesso.'
  });
});

/**
 * POST /api/backup — Gera cópia de segurança do banco de dados SQLite
 */
apiRouter.post('/backup', (_req: Request, res: Response) => {
  try {
    const backupPath = createBackup();
    res.json({
      sucesso: true,
      mensagem: 'Backup gerado com sucesso.',
      caminho: backupPath
    });
  } catch (err: any) {
    res.status(500).json({
      sucesso: false,
      erro: `Erro ao gerar backup: ${err.message}`
    });
  }
});
