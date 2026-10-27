import fs from 'fs';
import path from 'path';
// @ts-ignore
import initSqlJsInline from 'sql.js/dist/sql-wasm-inline.js';
import initSqlJsDefault, { Database, SqlValue } from 'sql.js';
import { config } from '../config/index.js';
import { generateSalt, hashPassword } from '../utils/security.js';

let dbInstance: Database | null = null;
let saveDebounceTimer: NodeJS.Timeout | null = null;

/**
 * Salva o estado do banco SQLite no arquivo local em disco
 */
export function persistDatabase(): void {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(config.dbPath, buffer);
  } catch (err) {
    const fallbackPath = path.join('/tmp', 'sgh.sqlite3');
    if (config.dbPath !== fallbackPath) {
      try {
        const data = dbInstance.export();
        fs.writeFileSync(fallbackPath, Buffer.from(data));
        config.dbPath = fallbackPath;
        return;
      } catch {}
    }
    console.warn('[DATABASE] Persistência em disco ignorada (ambiente somente leitura/serverless):', err);
  }
}

/**
 * Agenda a gravação em disco para evitar I/O excessivo durante fluxo contínuo
 */
export function schedulePersist(): void {
  if (saveDebounceTimer) return;
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    persistDatabase();
  }, 1000);
}

/**
 * Carrega a engine do SQLite WebAssembly de forma ultra-resiliente
 * Dá prioridade ao build inline (WASM embutido em Base64), eliminando o erro ENOENT
 * de sql-wasm.wasm em ambientes serverless da Vercel ou AWS Lambda.
 */
async function loadSqlJsEngine() {
  // 1. Tenta prioritariamente a versão inline com WebAssembly embutido em Base64
  try {
    const inlineLoader = (initSqlJsInline && (initSqlJsInline as any).default) || initSqlJsInline;
    if (typeof inlineLoader === 'function') {
      const sqlEngine = await inlineLoader();
      if (sqlEngine && sqlEngine.Database) {
        return sqlEngine;
      }
    }
  } catch (inlineErr) {
    console.warn('[DATABASE] Aviso: motor WASM inline falhou, tentando fallback com arquivos em disco:', inlineErr);
  }

  // 2. Se o inline falhar, procura o arquivo binário sql-wasm.wasm nos caminhos possíveis
  const candidateWasmPaths = [
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join('/var/task', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join('/var/task', 'dist', 'sql-wasm.wasm'),
    path.resolve(process.cwd(), 'dist', 'sql-wasm.wasm')
  ];

  for (const candidatePath of candidateWasmPaths) {
    try {
      if (fs.existsSync(candidatePath)) {
        const wasmBinary = fs.readFileSync(candidatePath);
        const arrayBuffer = wasmBinary.buffer.slice(
          wasmBinary.byteOffset,
          wasmBinary.byteOffset + wasmBinary.byteLength
        ) as ArrayBuffer;
        return await initSqlJsDefault({ wasmBinary: arrayBuffer });
      }
    } catch {}
  }

  // 3. Fallback padrão com locateFile customizado
  return await initSqlJsDefault({
    locateFile: (file: string) => {
      for (const candidatePath of candidateWasmPaths) {
        if (candidatePath.endsWith(file) && fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }
      return file;
    }
  });
}

/**
 * Inicializa a conexão SQLite, cria tabelas e insere dados essenciais
 */
export async function initDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await loadSqlJsEngine();
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn('[DATABASE] Não foi possível criar diretório para banco, usando fallback:', err);
    }
  }

  let activeDb: Database;
  if (fs.existsSync(config.dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(config.dbPath);
      activeDb = new SQL.Database(fileBuffer);
    } catch (err) {
      console.warn('[DATABASE] Arquivo SQLite existente corrompido ou inacessível. Criando novo.', err);
      activeDb = new SQL.Database();
    }
  } else {
    activeDb = new SQL.Database();
  }
  dbInstance = activeDb;

  // Criação das tabelas relacionais
  activeDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL,
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS configuracoes (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      descricao TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leituras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      vazao_lmin REAL NOT NULL,
      litros_incrementais REAL NOT NULL,
      litros_acumulados REAL NOT NULL,
      custo_incremental REAL NOT NULL,
      custo_acumulado REAL NOT NULL,
      status TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'real'
    );

    CREATE INDEX IF NOT EXISTS idx_leituras_timestamp ON leituras(timestamp);

    CREATE TABLE IF NOT EXISTS alertas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      tipo TEXT NOT NULL,
      severidade TEXT NOT NULL,
      descricao TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativo',
      valor_detectado REAL,
      resolvido_em TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_alertas_status ON alertas(status);

    CREATE TABLE IF NOT EXISTS eventos_sistema (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      tipo TEXT NOT NULL,
      mensagem TEXT NOT NULL,
      detalhe TEXT
    );
  `);

  // Seeding de configurações padrão
  seedDefaultConfig(activeDb);

  // Seeding do usuário administrador inicial se não existir
  seedAdminUser(activeDb);

  // Persiste a estrutura inicial em disco
  persistDatabase();

  return activeDb;
}

/**
 * Insere configurações padrão se ainda não existirem
 */
function seedDefaultConfig(db: Database) {
  const defaults = [
    { chave: 'tarifa_m3', valor: config.defaultTariffM3.toString(), desc: 'Tarifa de água em R$/m³' },
    { chave: 'tipo_cobranca', valor: 'm3', desc: 'Método de cobrança: m3 (R$/m³) ou litro (R$/L)' },
    { chave: 'tarifa_litro', valor: (config.defaultTariffM3 / 1000).toFixed(5), desc: 'Custo equivalente por litro em R$' },
    { chave: 'fator_calibracao', valor: config.defaultCalibrationFactor.toString(), desc: 'Fator de calibração do sensor (ex: 7.5)' },
    { chave: 'vazao_maxima_lmin', valor: config.defaultMaxFlowLmin.toString(), desc: 'Vazão máxima esperada antes de alerta de ruptura' },
    { chave: 'tempo_fluxo_continuo_min', valor: config.defaultContinuousFlowLimitMin.toString(), desc: 'Tempo contínuo limite em minutos para alerta de vazamento' },
    { chave: 'horario_inativo_inicio', valor: '01:00', desc: 'Início do período noturno de baixo consumo' },
    { chave: 'horario_inativo_fim', valor: '05:00', desc: 'Fim do período noturno de baixo consumo' },
    { chave: 'intervalo_leitura_ms', valor: config.defaultPollingIntervalMs.toString(), desc: 'Frequência recomendada de polling do frontend' },
    { chave: 'porta_serial', valor: config.serialPort, desc: 'Porta serial configurada' },
    { chave: 'taxa_transmissao', valor: config.serialBaudrate.toString(), desc: 'Taxa em bps da porta serial' }
  ];

  const now = new Date().toISOString();
  for (const item of defaults) {
    const existing = db.exec(`SELECT chave FROM configuracoes WHERE chave = '${item.chave}'`);
    if (existing.length === 0 || existing[0].values.length === 0) {
      db.run(
        `INSERT INTO configuracoes (chave, valor, descricao, updated_at) VALUES (?, ?, ?, ?)`,
        [item.chave, item.valor, item.desc, now]
      );
    }
  }
}

/**
 * Cria o usuário administrador inicial
 */
function seedAdminUser(db: Database) {
  const result = db.exec(`SELECT id FROM users WHERE username = '${config.adminUsername}'`);
  if (result.length === 0 || result[0].values.length === 0) {
    const salt = generateSalt();
    const hash = hashPassword(config.adminPasswordDefault, salt);
    const now = new Date().toISOString();
    
    db.run(
      `INSERT INTO users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?)`,
      [config.adminUsername, hash, salt, 'admin', now]
    );

    db.run(
      `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, ?, ?, ?)`,
      [now, 'SEGURANCA', 'Administrador inicial criado com sucesso', `Usuário: ${config.adminUsername}`]
    );
  }
}

/**
 * Executa uma consulta e retorna todos os registros mapeados em objetos
 */
export function queryAll<T = any>(sql: string, params: SqlValue[] = []): T[] {
  if (!dbInstance) throw new Error('Banco de dados SQLite não inicializado');
  const stmt = dbInstance.prepare(sql);
  if (params && params.length > 0) {
    stmt.bind(params);
  }
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return results;
}

/**
 * Executa uma consulta e retorna um único registro ou null
 */
export function queryOne<T = any>(sql: string, params: SqlValue[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Executa uma instrução SQL (INSERT, UPDATE, DELETE)
 */
export function run(sql: string, params: SqlValue[] = []): { changes: number } {
  if (!dbInstance) throw new Error('Banco de dados SQLite não inicializado');
  dbInstance.run(sql, params);
  const changes = dbInstance.getRowsModified();
  schedulePersist();
  return { changes };
}

/**
 * Realiza backup do banco para arquivo com timestamp
 */
export function createBackup(): string {
  persistDatabase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(process.cwd(), 'data', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const backupPath = path.join(backupDir, `sgh_backup_${timestamp}.sqlite3`);
  fs.copyFileSync(config.dbPath, backupPath);
  return backupPath;
}
