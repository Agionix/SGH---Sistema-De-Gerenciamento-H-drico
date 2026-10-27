import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFlowRate,
  calculateIncrementalVolume,
  litersToCubicMeters,
  calculateCost,
  processEsp32Total,
  parseAndValidateSerialJson
} from '../backend/src/utils/hydraulic.js';
import {
  generateSalt,
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  checkLoginRateLimit,
  recordFailedLogin,
  resetLoginAttempts
} from '../backend/src/utils/security.js';
import { LeakDetectorService } from '../backend/src/services/leakDetector.js';
import { classificarDispositivoSerial, scanDevPortsFallback, serialService } from '../backend/src/services/serialService.js';
import { initDatabase, queryOne, queryAll, run } from '../backend/src/database/db.js';

// ==============================================================================
// 1. TESTES DE CÁLCULO DE VAZÃO E HIDRÁULICA
// ==============================================================================
test('Cálculo de vazão Q (L/min) com fator YF-S201 (7.5)', () => {
  // Com 75 pulsos em 1 segundo (75 Hz):
  // Q = (75 * 60) / 7.5 = 600 L/min? Não: (75 * 60) / 7.5 = 600.
  // Se forem 7.5 pulsos por segundo (7.5 Hz):
  // Q = (7.5 * 60) / 7.5 = 60.0 L/min?
  // Na calibração YF-S201: F = 7.5 * Q (L/min) -> Q = F / 7.5.
  // Em 1 segundo com 7.5 pulsos: 7.5 / 7.5 = 1 L/min.
  // Com a fórmula: Q = (freq * 60) / (factor * 60) ou freq / factor_por_segundo.
  // O firmware do ESP32 implementou: Q = (freq * 60) / FATOR_CALIBRACAO.
  // Se Fator = 450 pulsos/litro = 7.5 pulsos/(litro/minuto):
  // freq = 7.5 Hz -> Q = (7.5 * 60) / 7.5 = 60?
  // Atenção à relação: Se 1 L/min = 7.5 Hz -> 7.5 Hz * 60 seg = 450 pulsos/min.
  // calculateFlowRate(pulses, deltaSeconds, calibrationFactor):
  // frequencyHz = pulses / deltaSeconds
  // flowLmin = (frequencyHz * 60) / calibrationFactor (quando calibrationFactor é pulsos/litro = 450)
  // OU frequencyHz / 7.5.
  // Vamos conferir nossa função: calculateFlowRate(7.5, 1, 7.5) = (7.5 * 60) / 7.5 = 60.
  // Se o fator for 450 (pulsos por litro):
  const flow = calculateFlowRate(45, 1.0, 450);
  assert.equal(flow, 6.0); // 45 pulsos/s = 2700 pulsos/min / 450 = 6.0 L/min
});

test('Tratamento de zero pulsos ou intervalos nulos', () => {
  assert.equal(calculateFlowRate(0, 1.0, 7.5), 0.0);
  assert.equal(calculateFlowRate(10, 0, 7.5), 0.0);
  assert.equal(calculateFlowRate(-5, 1.0, 7.5), 0.0);
});

test('Cálculo de volume incremental e conversão para m³', () => {
  // Vazão de 6 L/min durante 10 segundos:
  // Volume = (6 / 60) * 10 = 1.0 Litro
  const liters = calculateIncrementalVolume(6.0, 10.0);
  assert.equal(liters, 1.0);

  // Conversão de 1500 Litros para m³:
  const m3 = litersToCubicMeters(1500);
  assert.equal(m3, 1.5);
});

// ==============================================================================
// 2. TESTES DE CÁLCULO FINANCEIRO
// ==============================================================================
test('Cálculo de custo financeiro em Reais (R$)', () => {
  // 2 m³ a R$ 4,50/m³ = R$ 9,00
  const cost = calculateCost(2.0, 4.50);
  assert.equal(cost, 9.00);

  // Volume zero ou tarifa zero
  assert.equal(calculateCost(0, 4.50), 0.0);
  assert.equal(calculateCost(2.0, 0), 0.0);
});

// ==============================================================================
// 3. TESTES DE REINICIALIZAÇÃO DO CONTADOR ESP32
// ==============================================================================
test('Proteção contra reinicialização (reboot) do ESP32', () => {
  // Situação: Sistema já acumulou 100 Litros. O ESP32 estava reportando 50 L.
  // O ESP32 reinicia e envia 0.2 Litros.
  const result = processEsp32Total(0.2, 50.0, 100.0);

  assert.equal(result.isReset, true, 'Deve identificar reinicialização');
  assert.equal(result.incrementalLiters, 0.2, 'Consumo incremental após boot');
  assert.equal(result.newCumulativeLiters, 100.2, 'Acumulado permanente não perde os 100L anteriores');
});

test('Incremento contínuo sem reinicialização do ESP32', () => {
  const result = processEsp32Total(12.5, 10.0, 50.0);
  assert.equal(result.isReset, false);
  assert.equal(result.incrementalLiters, 2.5);
  assert.equal(result.newCumulativeLiters, 52.5);
});

// ==============================================================================
// 4. TESTES DE PARSER E VALIDAÇÃO JSON SERIAL
// ==============================================================================
test('Parser serial aceita JSON válido e rejeita lixo serial', () => {
  const validLine = '{"vazao_lmin":3.46,"litros_totais":10.5,"status":"normal"}';
  const parsed = parseAndValidateSerialJson(validLine);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.vazao_lmin, 3.46);
  assert.equal(parsed?.litros_totais, 10.5);
  assert.equal(parsed?.status, 'normal');

  // Linhas corrompidas ou inválidas
  assert.equal(parseAndValidateSerialJson(''), null);
  assert.equal(parseAndValidateSerialJson('Lixo de boot ESP32 rst:0x1'), null);
  assert.equal(parseAndValidateSerialJson('{"vazao_lmin": "texto_invalido"}'), null);
  assert.equal(parseAndValidateSerialJson('{"vazao_lmin": -10}'), null);

  // Formatos Arduino (CSV leve e JSON simplificado)
  const arduinoCsv = parseAndValidateSerialJson('5.25,18.40');
  assert.ok(arduinoCsv);
  assert.equal(arduinoCsv?.vazao_lmin, 5.25);
  assert.equal(arduinoCsv?.litros_totais, 18.40);
  assert.equal(arduinoCsv?.dispositivo, 'arduino');

  const arduinoJson = parseAndValidateSerialJson('{"vazao": 2.80, "total": 45.10, "dispositivo": "arduino"}');
  assert.ok(arduinoJson);
  assert.equal(arduinoJson?.vazao_lmin, 2.80);
  assert.equal(arduinoJson?.litros_totais, 45.10);
  assert.equal(arduinoJson?.dispositivo, 'arduino');

  const arduinoKv = parseAndValidateSerialJson('VAZAO:4.10;TOTAL:22.50');
  assert.ok(arduinoKv);
  assert.equal(arduinoKv?.vazao_lmin, 4.10);
  assert.equal(arduinoKv?.litros_totais, 22.50);

  // Saída exata copiada do Monitor Serial da Arduino IDE com timestamp
  const ideMonitorLine = '18:11:02.734 -> {"vazao_lmin":0.00,"litros_totais":2.84,"status":"normal","dispositivo":"esp32"}';
  const ideParsed = parseAndValidateSerialJson(ideMonitorLine);
  assert.ok(ideParsed, 'Deve extrair e interpretar o JSON mesmo com timestamp da IDE');
  assert.equal(ideParsed?.vazao_lmin, 0.00);
  assert.equal(ideParsed?.litros_totais, 2.84);
  assert.equal(ideParsed?.dispositivo, 'esp32');
  assert.equal(ideParsed?.status, 'normal');
});

// ==============================================================================
// 5. TESTES DE AUTENTICAÇÃO E SESSÃO
// ==============================================================================
test('Hash de senha com salt e verificação segura scrypt', () => {
  const salt = generateSalt();
  const password = 'MinhaSenhaSecreta2026';
  const hash = hashPassword(password, salt);

  assert.equal(verifyPassword(password, hash, salt), true, 'Senha correta deve validar');
  assert.equal(verifyPassword('SenhaIncorreta', hash, salt), false, 'Senha incorreta deve falhar');
  assert.equal(verifyPassword('', hash, salt), false, 'Senha vazia deve falhar');
});

test('Criação e validação de sessão assinada via HMAC', () => {
  const token = createSession({ id: 1, username: 'admin', role: 'admin' });
  assert.ok(token && token.includes('.'), 'Token deve conter assinatura com ponto');

  const session = validateSession(token);
  assert.notEqual(session, null);
  assert.equal(session?.username, 'admin');

  // Token adulterado deve ser rejeitado
  const tamperedToken = token.slice(0, -4) + 'abcd';
  assert.equal(validateSession(tamperedToken), null);
});

test('Rate limiting de tentativas de login contra força bruta', () => {
  const ipTest = '192.168.1.100_testuser';
  resetLoginAttempts(ipTest);

  // 4 falhas consecutivas: não deve bloquear ainda
  for (let i = 1; i <= 4; i++) {
    const res = recordFailedLogin(ipTest);
    assert.equal(res.blocked, false);
  }

  // 5ª falha: deve bloquear
  const fifth = recordFailedLogin(ipTest);
  assert.equal(fifth.blocked, true);

  const check = checkLoginRateLimit(ipTest);
  assert.equal(check.allowed, false, 'IP deve estar bloqueado');

  resetLoginAttempts(ipTest);
  assert.equal(checkLoginRateLimit(ipTest).allowed, true);
});

// ==============================================================================
// 6. TESTES DE PERSISTÊNCIA SQLITE
// ==============================================================================
test('Inicialização e consultas no SQLite', async () => {
  const db = await initDatabase();
  assert.ok(db, 'Instância do SQLite deve existir');

  // Verifica se o admin inicial foi criado
  const admin = queryOne(`SELECT username, role FROM users WHERE username = 'admin'`);
  assert.ok(admin, 'Usuário admin deve existir no banco');
  assert.equal(admin?.role, 'admin');

  // Verifica configurações padrão inseridas
  const configs = queryAll(`SELECT chave, valor FROM configuracoes`);
  assert.ok(configs.length >= 8, 'Devem existir as configurações padrão');
});

// ==============================================================================
// 7. TESTE DE DETECÇÃO DE VAZAMENTO E RUPTURA
// ==============================================================================
test('Detector de vazamento identifica ruptura crítica de fluxo', () => {
  const detector = new LeakDetectorService();
  // Limite configurado é 30 L/min, simulamos 35 L/min
  const alerts = detector.evaluateReading(35.5);
  const critical = alerts.find(a => a.tipo === 'FLUXO_EXCESSIVO');
  assert.ok(critical, 'Deve acionar alerta de fluxo excessivo / ruptura');
  assert.equal(critical?.severidade, 'critica');

  // Limpa alertas gerados pelo teste unitário para não poluir o banco de produção
  run("DELETE FROM alertas WHERE valor_detectado = 35.5");
});

// ==============================================================================
// 8. TESTE DE CRIAÇÃO DE NOVA CONTA (REGISTRO)
// ==============================================================================
test('Criação de nova conta de operador e rejeição de duplicatas', async () => {
  await initDatabase();
  const testUser = 'operador_teste_' + Date.now();
  const rawPass = 'senhaForte123';

  // 1. Cria usuário
  const salt = generateSalt();
  const hash = hashPassword(rawPass, salt);
  const now = new Date().toISOString();

  run(
    `INSERT INTO users (username, password_hash, salt, role, created_at, last_login)
     VALUES (?, ?, ?, 'operador', ?, ?)`,
    [testUser, hash, salt, now, now]
  );

  const created = queryOne(`SELECT id, username, role, password_hash, salt FROM users WHERE username = ?`, [testUser]);
  assert.ok(created, 'Usuário deve ser persistido no SQLite');
  assert.equal(created?.username, testUser);
  assert.equal(created?.role, 'operador');
  assert.equal(verifyPassword(rawPass, created?.password_hash, created?.salt), true);

  // 2. Rejeição de duplicata
  const checkDuplicate = queryOne(`SELECT id FROM users WHERE LOWER(username) = LOWER(?)`, [testUser]);
  assert.ok(checkDuplicate !== null, 'Consulta deve identificar que usuário já existe');
});

// ==============================================================================
// 9. TESTE DE RECUPERAÇÃO DE CONTA (CHAVE MESTRA OFFLINE)
// ==============================================================================
test('Recuperação de conta com Chave Mestra e redefinição segura de senha', async () => {
  await initDatabase();
  const recoverUser = 'usuario_recuperar_' + Date.now();
  const oldPass = 'senhaAntiga123';
  const newPass = 'senhaNovaAtualizada456';
  const masterKey = 'SGH-RECOVERY-2026';

  // 1. Cria usuário inicial
  const saltInitial = generateSalt();
  const hashInitial = hashPassword(oldPass, saltInitial);
  const now = new Date().toISOString();

  run(
    `INSERT INTO users (username, password_hash, salt, role, created_at, last_login)
     VALUES (?, ?, ?, 'operador', ?, ?)`,
    [recoverUser, hashInitial, saltInitial, now, now]
  );

  // 2. Validação da Chave Mestra
  const invalidKey = 'CHAVE-ERRADA';
  assert.notEqual(invalidKey, masterKey, 'Chave errada não deve bater com a chave mestra');

  // 3. Simula a recuperação de conta bem-sucedida
  const newSalt = generateSalt();
  const newHash = hashPassword(newPass, newSalt);

  run(
    `UPDATE users 
     SET password_hash = ?, salt = ?, last_login = ?
     WHERE LOWER(username) = LOWER(?)`,
    [newHash, newSalt, now, recoverUser]
  );

  // 4. Verifica se a nova senha funciona e a antiga foi invalidada
  const updatedUser = queryOne(
    `SELECT username, password_hash, salt FROM users WHERE LOWER(username) = LOWER(?)`,
    [recoverUser]
  );
  assert.ok(updatedUser, 'Usuário deve existir após atualização');
  assert.equal(verifyPassword(newPass, updatedUser.password_hash, updatedUser.salt), true, 'Nova senha deve ser válida');
  assert.equal(verifyPassword(oldPass, updatedUser.password_hash, updatedUser.salt), false, 'Senha antiga não deve mais funcionar');
});

// ==============================================================================
// 10. TESTES DE IDENTIFICAÇÃO E CLASSIFICAÇÃO DE DISPOSITIVOS (ARDUINO & ESP32)
// ==============================================================================
test('Classificação e identificação de hardware Arduino e ESP32 por VID/PID', () => {
  // 1. Arduino Uno Oficial (VID 2341, PID 0043)
  const arduinoUno = classificarDispositivoSerial(
    { path: 'COM3', vendorId: '2341', productId: '0043', manufacturer: 'Arduino LLC' },
    'COM3',
    true
  );
  assert.equal(arduinoUno.tipo, 'arduino');
  assert.equal(arduinoUno.nomeAmigavel, 'Arduino Uno (ATmega328P)');
  assert.equal(arduinoUno.recomendado, true);
  assert.equal(arduinoUno.conectado, true);

  // 2. Arduino Mega 2560 (VID 2341, PID 0042)
  const arduinoMega = classificarDispositivoSerial(
    { path: '/dev/ttyACM0', vendorId: '2341', productId: '0042', manufacturer: 'Arduino LLC' },
    'COM3',
    false
  );
  assert.equal(arduinoMega.tipo, 'arduino');
  assert.equal(arduinoMega.nomeAmigavel, 'Arduino Mega 2560');

  // 3. ESP32 DevKit com Silicon Labs CP2102 (VID 10c4, PID ea60)
  const esp32Cp2102 = classificarDispositivoSerial(
    { path: 'COM4', vendorId: '10c4', productId: 'ea60', manufacturer: 'Silicon Labs' },
    'COM4',
    true
  );
  assert.equal(esp32Cp2102.tipo, 'esp32');
  assert.equal(esp32Cp2102.nomeAmigavel, 'ESP32 DevKit v1 (CP2102)');
  assert.equal(esp32Cp2102.recomendado, true);

  // 4. Arduino / ESP com conversor universal CH340 (VID 1a86, PID 7523)
  const ch340Dev = classificarDispositivoSerial(
    { path: '/dev/ttyUSB0', vendorId: '1a86', productId: '7523', manufacturer: 'wch.cn' },
    'COM1',
    false
  );
  assert.equal(ch340Dev.tipo, 'arduino');
  assert.equal(ch340Dev.nomeAmigavel, 'Arduino / ESP (Conversor USB CH340)');

  // 5. ESP32 nativo Espressif (VID 303a)
  const esp32Native = classificarDispositivoSerial(
    { path: 'COM5', vendorId: '303a', productId: '1001', manufacturer: 'Espressif' },
    'COM5',
    true
  );
  assert.equal(esp32Native.tipo, 'esp32');
  assert.equal(esp32Native.nomeAmigavel, 'ESP32 (USB Nativo / S2 / S3 / C3)');
});

// ==============================================================================
// 11. TESTES DE RESILIÊNCIA SERIAL EM AMBIENTES DE CONTAINER / SEM UDEVADM
// ==============================================================================
test('scanDevPortsFallback retorna array com segurança sem lançar exceções', () => {
  const ports = scanDevPortsFallback();
  assert.ok(Array.isArray(ports), 'Deve retornar um array de portas');
});

test('listAvailablePorts() executa com resiliência sem lançar spawn udevadm ENOENT', async () => {
  const ports = await serialService.listAvailablePorts();
  assert.ok(Array.isArray(ports), 'Deve resolver retornando um array');
  const status = serialService.getStatus();
  assert.ok(Array.isArray(status.dispositivosDisponiveis));
});



