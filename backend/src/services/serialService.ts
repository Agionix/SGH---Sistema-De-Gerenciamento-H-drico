import fs from 'node:fs';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { config } from '../config/index.js';
import { queryOne, run } from '../database/db.js';
import {
  parseAndValidateSerialJson,
  processEsp32Total,
  calculateCost,
  litersToCubicMeters
} from '../utils/hydraulic.js';
import { leakDetector } from './leakDetector.js';

export interface DispositivoIdentificado {
  path: string;
  manufacturer: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
  pnpId?: string;
  tipo: 'arduino' | 'esp32' | 'generico';
  nomeAmigavel: string;
  descricao: string;
  icone: 'arduino' | 'esp32' | 'usb';
  baudRecomendado: number;
  conectado: boolean;
  recomendado: boolean;
}

export interface SerialStatusInfo {
  connected: boolean;
  portPath: string;
  baudRate: number;
  lastReadingTime: string | null;
  lastFlowLmin: number;
  lastTotalLiters: number;
  totalCostEstimated: number;
  errorMessage: string | null;
  dispositivoAtual: DispositivoIdentificado | null;
  tipoDetectado: 'arduino' | 'esp32' | 'generico' | 'simulado' | 'nenhum';
  dispositivosDisponiveis: DispositivoIdentificado[];
}

/**
 * Classifica e identifica placas Arduino e ESP32 com base em VID, PID e Fabricante USB
 */
export function classificarDispositivoSerial(
  portInfo: any,
  activePortPath: string,
  isConnected: boolean
): DispositivoIdentificado {
  const vid = String(portInfo.vendorId || '').toLowerCase();
  const pid = String(portInfo.productId || '').toLowerCase();
  const mfg = String(portInfo.manufacturer || '').toLowerCase();
  const pnp = String(portInfo.pnpId || '').toLowerCase();
  const path = String(portInfo.path || '');
  const isThisConnected = isConnected && path.toLowerCase() === activePortPath.toLowerCase();

  // 1. FAMÍLIA ARDUINO OFICIAL (VID: 0x2341 ou 0x2a03)
  if (vid === '2341' || vid === '2a03' || mfg.includes('arduino') || pnp.includes('arduino')) {
    let nome = 'Arduino (Oficial)';
    if (pid === '0043' || pid === '0001') nome = 'Arduino Uno (ATmega328P)';
    else if (pid === '0042' || pid === '0010') nome = 'Arduino Mega 2560';
    else if (pid === '0036' || pid === '8036') nome = 'Arduino Leonardo';
    else if (pid === '0058') nome = 'Arduino Nano Every';
    else if (pid === '0044') nome = 'Arduino Nano';

    return {
      path,
      manufacturer: portInfo.manufacturer || 'Arduino LLC',
      vendorId: portInfo.vendorId,
      productId: portInfo.productId,
      serialNumber: portInfo.serialNumber,
      pnpId: portInfo.pnpId,
      tipo: 'arduino',
      nomeAmigavel: nome,
      descricao: 'Placa Arduino oficial detectada. Sensor YF-S201 no Pino Digital 2 (Interrupção INT0).',
      icone: 'arduino',
      baudRecomendado: 115200,
      conectado: isThisConnected,
      recomendado: true
    };
  }

  // 2. FAMÍLIA ESPRESSIF ESP32 / ESP8266 COM USB NATIVO (VID: 0x303a)
  if (vid === '303a' || mfg.includes('espressif') || pnp.includes('espressif')) {
    return {
      path,
      manufacturer: portInfo.manufacturer || 'Espressif Systems',
      vendorId: portInfo.vendorId,
      productId: portInfo.productId,
      serialNumber: portInfo.serialNumber,
      pnpId: portInfo.pnpId,
      tipo: 'esp32',
      nomeAmigavel: 'ESP32 (USB Nativo / S2 / S3 / C3)',
      descricao: 'SoC ESP32 com suporte a FreeRTOS e interrupção no GPIO 2.',
      icone: 'esp32',
      baudRecomendado: 115200,
      conectado: isThisConnected,
      recomendado: true
    };
  }

  // 3. FAMÍLIA SILICON LABS CP2102 / CP2104 (VID: 0x10c4) — Muito comum em ESP32 DevKit v1 e NodeMCU
  if (vid === '10c4' || mfg.includes('silicon labs') || pnp.includes('cp210')) {
    return {
      path,
      manufacturer: portInfo.manufacturer || 'Silicon Labs CP210x',
      vendorId: portInfo.vendorId,
      productId: portInfo.productId,
      serialNumber: portInfo.serialNumber,
      pnpId: portInfo.pnpId,
      tipo: 'esp32',
      nomeAmigavel: 'ESP32 DevKit v1 (CP2102)',
      descricao: 'Módulo ESP32 clássico com conversor USB CP2102. Sensor conectado no GPIO 2.',
      icone: 'esp32',
      baudRecomendado: 115200,
      conectado: isThisConnected,
      recomendado: true
    };
  }

  // 4. CONVERSOR CH340 / CH341 (VID: 0x1a86) — Padrão mais popular de Arduino Nano/Uno e ESP32
  if (vid === '1a86' || mfg.includes('wch') || pnp.includes('ch340') || pnp.includes('ch341')) {
    return {
      path,
      manufacturer: portInfo.manufacturer || 'WCH QinHeng',
      vendorId: portInfo.vendorId,
      productId: portInfo.productId,
      serialNumber: portInfo.serialNumber,
      pnpId: portInfo.pnpId,
      tipo: 'arduino',
      nomeAmigavel: 'Arduino / ESP (Conversor USB CH340)',
      descricao: 'Interface CH340 universal. Suporta Arduino Uno/Nano (Pino 2) e placas ESP32.',
      icone: 'arduino',
      baudRecomendado: 115200,
      conectado: isThisConnected,
      recomendado: true
    };
  }

  // 5. CONVERSOR FTDI FT232R (VID: 0x0403) — Comum em Arduino Nano original / industrial
  if (vid === '0403' || mfg.includes('ftdi') || pnp.includes('ftdi')) {
    return {
      path,
      manufacturer: portInfo.manufacturer || 'FTDI Chip',
      vendorId: portInfo.vendorId,
      productId: portInfo.productId,
      serialNumber: portInfo.serialNumber,
      pnpId: portInfo.pnpId,
      tipo: 'arduino',
      nomeAmigavel: 'Arduino Nano (FTDI FT232)',
      descricao: 'Conversor FTDI. Perfeito para Arduino Nano com leitura de pulsos no Pino 2.',
      icone: 'arduino',
      baudRecomendado: 115200,
      conectado: isThisConnected,
      recomendado: true
    };
  }

  // 6. DISPOSITIVO GENÉRICO OU OUTRA PORTA SERIAL
  return {
    path,
    manufacturer: portInfo.manufacturer || 'Porta Serial Padrão',
    vendorId: portInfo.vendorId,
    productId: portInfo.productId,
    serialNumber: portInfo.serialNumber,
    pnpId: portInfo.pnpId,
    tipo: 'generico',
    nomeAmigavel: `Porta Serial USB (${path})`,
    descricao: portInfo.manufacturer ? `Fabricante: ${portInfo.manufacturer}` : 'Porta de comunicação serial do sistema',
    icone: 'usb',
    baudRecomendado: 115200,
    conectado: isThisConnected,
    recomendado: false
  };
}

/**
 * Varre portas seriais diretamente no diretório /dev (Linux / macOS).
 * Fallback resiliente para ambientes sem udevadm (Docker, Cloud Run, Vercel, WSL minimalista).
 */
export function scanDevPortsFallback(): Array<{ path: string; manufacturer?: string; pnpId?: string }> {
  if (process.platform === 'win32') {
    return [];
  }

  try {
    if (!fs.existsSync('/dev')) {
      return [];
    }
    const entries = fs.readdirSync('/dev');
    // Filtra dispositivos seriais clássicos USB e modems CDC ACM
    const serialMatches = entries.filter((name) =>
      /^(ttyUSB\d+|ttyACM\d+|rfcomm\d+|cu\.usbserial|cu\.usbmodem)/i.test(name)
    );

    return serialMatches.map((name) => ({
      path: `/dev/${name}`,
      manufacturer: name.startsWith('ttyACM') ? 'Arduino / CDC ACM' : 'Dispositivo USB Serial',
      pnpId: name
    }));
  } catch {
    return [];
  }
}

export class SerialCommunicationService {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private isConnected: boolean = false;
  private lastReadingTime: string | null = null;
  private lastEsp32ReportedTotal: number = -1;
  private systemCumulativeLiters: number = 0;
  private lastFlowLmin: number = 0;
  private lastErrorMessage: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private activePortPath: string = config.serialPort;
  private activeBaudRate: number = config.serialBaudrate;
  private currentDevice: DispositivoIdentificado | null = null;
  private lastDetectedType: 'arduino' | 'esp32' | 'generico' | 'nenhum' = 'nenhum';
  private cachedAvailableDevices: DispositivoIdentificado[] = [];
  private hasWarnedUdevMissing: boolean = false;

  constructor() {
    this.loadInitialCumulativeFromDb();
  }

  /**
   * Inicializa o total acumulado do banco para continuidade de contagem
   */
  private loadInitialCumulativeFromDb() {
    try {
      const lastRow = queryOne(
        `SELECT litros_acumulados FROM leituras ORDER BY id DESC LIMIT 1`
      );
      if (lastRow && typeof lastRow.litros_acumulados === 'number') {
        this.systemCumulativeLiters = lastRow.litros_acumulados;
      }
    } catch {
      this.systemCumulativeLiters = 0;
    }
  }

  /**
   * Lista e identifica todas as portas seriais físicas disponíveis no sistema operacional.
   * Suporta fallback resiliente quando udevadm não está instalado no host/container.
   */
  public async listAvailablePorts(): Promise<DispositivoIdentificado[]> {
    try {
      const ports = await SerialPort.list();
      const classified = ports.map(p => classificarDispositivoSerial(p, this.activePortPath, this.isConnected));
      this.cachedAvailableDevices = classified;
      return classified;
    } catch (err: any) {
      const errStr = String(err?.message || err || '');
      const isUdevadmMissing = err?.code === 'ENOENT' || errStr.includes('udevadm') || errStr.includes('ENOENT');

      if (isUdevadmMissing) {
        if (!this.hasWarnedUdevMissing) {
          this.hasWarnedUdevMissing = true;
          console.log('[SERIAL] Ambiente sem utilitário udevadm (container/nuvem). Utilizando detecção direta em /dev.');
        }
        const fallbackPorts = scanDevPortsFallback();
        const classified = fallbackPorts.map(p => classificarDispositivoSerial(p, this.activePortPath, this.isConnected));
        this.cachedAvailableDevices = classified;
        return classified;
      }

      console.warn('[SERIAL] Aviso ao listar portas:', errStr);
      return [];
    }
  }

  /**
   * Varre portas USB e conecta automaticamente ao primeiro Arduino ou ESP32 reconhecido
   */
  public async autoDetectAndConnect(): Promise<{
    sucesso: boolean;
    mensagem: string;
    dispositivo: DispositivoIdentificado | null;
  }> {
    const devices = await this.listAvailablePorts();
    if (devices.length === 0) {
      return {
        sucesso: false,
        mensagem: 'Nenhum dispositivo USB detectado no computador. Conecte seu Arduino ou ESP32 via cabo USB.',
        dispositivo: null
      };
    }

    // Prioriza dispositivos reconhecidos (Arduino ou ESP32)
    const target = devices.find(d => d.recomendado) || devices[0];
    const ok = this.connect(target.path, target.baudRecomendado);

    return {
      sucesso: ok,
      mensagem: ok
        ? `Dispositivo ${target.nomeAmigavel} detectado com sucesso na porta ${target.path}!`
        : `Dispositivo ${target.nomeAmigavel} detectado em ${target.path}, mas houve falha ao abrir a porta.`,
      dispositivo: target
    };
  }

  /**
   * Conecta à porta serial configurada com suporte a taxa baud customizável
   */
  public connect(portPath: string = this.activePortPath, baudRate: number = this.activeBaudRate): boolean {
    if (this.port && this.port.isOpen) {
      if (this.activePortPath === portPath && this.activeBaudRate === baudRate) {
        return true; // Já conectado na mesma porta e baudrate
      }
      this.disconnect();
    }

    this.activePortPath = portPath;
    this.activeBaudRate = baudRate;
    this.lastErrorMessage = null;

    // Atualiza representação do dispositivo atual
    this.currentDevice = classificarDispositivoSerial(
      { path: portPath, manufacturer: 'Conectando...' },
      portPath,
      true
    );

    // Se estiver em Linux/macOS e a porta for COM*, valida se é compatível
    if (process.platform !== 'win32' && portPath.toUpperCase().startsWith('COM')) {
      this.isConnected = false;
      this.lastErrorMessage = null;
      console.log(`[SERIAL] Porta ${portPath} é padrão Windows e não se aplica ao servidor Linux (${process.platform}). Aguardando telemetria via Web Serial (navegador) ou Wi-Fi.`);
      return false;
    }

    try {
      console.log(`[SERIAL] Conectando à porta ${this.activePortPath} a ${this.activeBaudRate} baud...`);
      
      this.port = new SerialPort({
        path: this.activePortPath,
        baudRate: this.activeBaudRate,
        autoOpen: false
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.port.open((err) => {
        if (err) {
          this.isConnected = false;
          const isNotFound = err.message.includes('No such file') || err.message.includes('cannot open');
          if (isNotFound) {
            console.log(`[SERIAL] Porta ${this.activePortPath} não encontrada fisicamente no servidor.`);
            this.lastErrorMessage = `Porta ${this.activePortPath} não detectada no servidor. Conecte pelo navegador (Web Serial) ou envie via Wi-Fi.`;
          } else {
            this.lastErrorMessage = `Falha ao abrir porta ${this.activePortPath}: ${err.message}`;
            console.warn(`[SERIAL] ${this.lastErrorMessage}`);
            this.scheduleReconnect();
          }
          return;
        }

        this.isConnected = true;
        this.lastErrorMessage = null;
        console.log(`[SERIAL] Conexão USB estabelecida com sucesso na porta ${this.activePortPath}`);

        run(
          `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, 'SERIAL', ?, ?)`,
          [new Date().toISOString(), 'CONECTADO', `Porta ${this.activePortPath} conectada a ${this.activeBaudRate} bps`]
        );
      });

      // Trata as linhas de dados recebidas
      this.parser.on('data', (line: string) => {
        this.handleIncomingLine(line);
      });

      // Trata erros de conexão
      this.port.on('error', (err: any) => {
        this.isConnected = false;
        this.lastErrorMessage = `Erro na comunicação serial: ${err.message}`;
        console.warn(`[SERIAL] ${this.lastErrorMessage}`);
        this.scheduleReconnect();
      });

      // Trata desconexão física
      this.port.on('close', () => {
        if (this.isConnected) {
          console.warn(`[SERIAL] Porta ${this.activePortPath} desconectada fisicamente.`);
          this.isConnected = false;
          run(
            `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, 'SERIAL', 'DESCONECTADO', ?)`,
            [new Date().toISOString(), `Porta ${this.activePortPath} fechada.`]
          );
        }
        this.scheduleReconnect();
      });

      return true;
    } catch (err: any) {
      this.isConnected = false;
      this.lastErrorMessage = err.message || 'Erro na inicialização serial';
      return false;
    }
  }

  /**
   * Processa linha de texto recebida do ESP32
   */
  public handleIncomingLine(rawLine: string): boolean {
    const payload = parseAndValidateSerialJson(rawLine);
    if (!payload) {
      // Ignora silenciosamente mensagens corrompidas ou ruído de inicialização
      return false;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    this.lastReadingTime = nowIso;
    this.lastFlowLmin = payload.vazao_lmin;
    this.isConnected = true;
    this.lastErrorMessage = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Registra o tipo de microcontrolador identificado a partir do payload ou conversor
    if (payload.dispositivo && payload.dispositivo !== 'generico') {
      this.lastDetectedType = payload.dispositivo;
    } else if (this.currentDevice && this.currentDevice.tipo !== 'generico') {
      this.lastDetectedType = this.currentDevice.tipo;
    }

    // Processa acúmulo prevenindo duplicatas e reinicializações do microcontrolador
    const accumulation = processEsp32Total(
      payload.litros_totais,
      this.lastEsp32ReportedTotal,
      this.systemCumulativeLiters
    );

    this.lastEsp32ReportedTotal = payload.litros_totais;
    this.systemCumulativeLiters = accumulation.newCumulativeLiters;

    if (accumulation.isReset) {
      const devLabel = this.lastDetectedType === 'arduino' ? 'Arduino' : 'ESP32';
      run(
        `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe) VALUES (?, 'HARDWARE', 'REINICIALIZACAO_DISPOSITIVO', ?)`,
        [nowIso, `${devLabel} reiniciou contador. Base acumulada mantida em ${this.systemCumulativeLiters.toFixed(2)} L`]
      );
    }

    // Calcula custos financeiros
    const tariffM3 = Number(queryOne(`SELECT valor FROM configuracoes WHERE chave = 'tarifa_m3'`)?.valor || 4.50);
    const m3Incremental = litersToCubicMeters(accumulation.incrementalLiters);
    const custoIncremental = calculateCost(m3Incremental, tariffM3);
    const m3Total = litersToCubicMeters(this.systemCumulativeLiters);
    const custoAcumulado = calculateCost(m3Total, tariffM3);

    // Avalia anomalias e possíveis vazamentos
    leakDetector.evaluateReading(payload.vazao_lmin, nowIso);

    // Grava leitura no banco SQLite marcando a origem (arduino, esp32 ou real)
    const origemGravacao = this.lastDetectedType === 'arduino' ? 'arduino' : (this.lastDetectedType === 'esp32' ? 'esp32' : 'real');
    run(
      `INSERT INTO leituras (
        timestamp, vazao_lmin, litros_incrementais, litros_acumulados,
        custo_incremental, custo_acumulado, status, origem
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nowIso,
        payload.vazao_lmin,
        accumulation.incrementalLiters,
        this.systemCumulativeLiters,
        custoIncremental,
        custoAcumulado,
        payload.status,
        origemGravacao
      ]
    );

    return true;
  }

  /**
   * Agenda reconexão periódica inteligente verificando a existência física da porta
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.isConnected) return;

      // Não tenta reconectar a COM* em sistemas não-Windows
      if (process.platform !== 'win32' && this.activePortPath.toUpperCase().startsWith('COM')) {
        return;
      }

      try {
        const ports = await this.listAvailablePorts();
        const found = ports.some(p => p.path.toLowerCase() === this.activePortPath.toLowerCase());
        if (found && config.serialAutoConnect) {
          this.connect(this.activePortPath, this.activeBaudRate);
        }
      } catch {
        // Ignora silenciosamente caso o hardware não esteja plugado
      }
    }, 8000);
  }

  /**
   * Desconecta e limpa recursos da porta
   */
  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.port && this.port.isOpen) {
      try {
        this.port.close();
      } catch (err) {
        console.error('[SERIAL] Erro ao fechar porta:', err);
      }
    }
    this.isConnected = false;
    this.port = null;
    this.parser = null;
  }

  /**
   * Retorna o estado atual da comunicação serial
   */
  public getStatus(): SerialStatusInfo {
    const tariffM3 = Number(queryOne(`SELECT valor FROM configuracoes WHERE chave = 'tarifa_m3'`)?.valor || 4.50);
    const totalM3 = litersToCubicMeters(this.systemCumulativeLiters);
    const totalCost = calculateCost(totalM3, tariffM3);

    return {
      connected: this.isConnected,
      portPath: this.activePortPath,
      baudRate: this.activeBaudRate,
      lastReadingTime: this.lastReadingTime,
      lastFlowLmin: this.lastFlowLmin,
      lastTotalLiters: Number(this.systemCumulativeLiters.toFixed(2)),
      totalCostEstimated: totalCost,
      errorMessage: this.lastErrorMessage,
      dispositivoAtual: this.currentDevice,
      tipoDetectado: this.lastDetectedType,
      dispositivosDisponiveis: this.cachedAvailableDevices
    };
  }

  /**
   * Atualiza a base de consumo acumulado do sistema (usado pelo simulador ou reset administrativo)
   */
  public setSystemCumulative(liters: number) {
    this.systemCumulativeLiters = Math.max(0, liters);
  }
}

export const serialService = new SerialCommunicationService();
