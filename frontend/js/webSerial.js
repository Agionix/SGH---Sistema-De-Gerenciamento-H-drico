/**
 * SGH — Módulo de Conexão Web Serial API (Navegador <-> ESP32 / Arduino)
 * Permite conexão USB nativa direta do navegador, funcionando tanto
 * localmente quanto em servidores remotos (Cloud Run / Web).
 */
import { SghApi } from './api.js';

class WebSerialManager {
  constructor() {
    this.port = null;
    this.reader = null;
    this.readableStreamClosed = null;
    this.isConnected = false;
    this.baudRate = 115200;
    this.onLineCallbacks = [];
    this.onStatusChangeCallbacks = [];
    this.onReadingCallbacks = [];
    this.lastReading = null;
  }

  isSupported() {
    return 'serial' in navigator;
  }

  onLine(callback) {
    this.onLineCallbacks.push(callback);
  }

  onStatusChange(callback) {
    this.onStatusChangeCallbacks.push(callback);
  }

  onReading(callback) {
    this.onReadingCallbacks.push(callback);
  }

  notifyStatus(connected, portInfo = null, error = null) {
    this.isConnected = connected;
    this.onStatusChangeCallbacks.forEach(cb => cb({ connected, portInfo, error }));
  }

  async connect(preferredBaud = 115200) {
    if (!this.isSupported()) {
      const msg = 'Seu navegador não suporta a Web Serial API. Para conectar direto ao USB pelo site, use o Google Chrome ou Microsoft Edge no computador.';
      this.notifyStatus(false, null, msg);
      throw new Error(msg);
    }

    this.baudRate = preferredBaud;

    try {
      // Solicita seleção da porta USB ao usuário (Abre janela nativa do Chrome/Edge)
      this.port = await navigator.serial.requestPort();
      
      const portInfo = this.port.getInfo ? this.port.getInfo() : {};
      console.log('[WebSerial] Porta selecionada:', portInfo);

      // Abre a conexão na velocidade configurada
      await this.port.open({ baudRate: this.baudRate });
      this.isConnected = true;
      console.log(`[WebSerial] Conectado a ${this.baudRate} bps!`);

      this.notifyStatus(true, portInfo, null);

      // Inicia loop de leitura contínua
      this.readLoop();
      return { sucesso: true, portInfo };
    } catch (err) {
      console.error('[WebSerial] Erro ao conectar:', err);
      let friendlyError = err.message || 'Falha ao conectar à porta serial.';

      const errStr = String(err).toLowerCase();
      const errName = err.name || '';

      if (
        errName === 'SecurityError' ||
        errStr.includes('permissions policy') ||
        errStr.includes('cross-origin') ||
        errStr.includes('disallowed') ||
        errStr.includes('feature')
      ) {
        friendlyError = 'O navegador bloqueou o USB porque a página está dentro de uma janela embutida (iframe). Clique no botão "Abrir em Nova Aba" para usar a porta USB com permissão total no Chrome/Edge.';
      } else if (
        errName === 'NetworkError' ||
        errStr.includes('failed to open') ||
        errStr.includes('busy') ||
        errStr.includes('denied') ||
        errStr.includes('access')
      ) {
        friendlyError = 'A porta USB não pôde ser aberta pelo navegador. Verifique se o cabo USB está bem conectado, se os drivers (CP2102/CH340) estão instalados e se nenhum outro aplicativo no Windows/Linux está bloqueando a porta.';
      } else if (errName === 'NotFoundError') {
        friendlyError = 'Nenhum dispositivo USB selecionado na lista do navegador.';
      }

      this.notifyStatus(false, null, friendlyError);
      throw new Error(friendlyError);
    }
  }

  async readLoop() {
    let lineBuffer = '';

    while (this.port && this.port.readable && this.isConnected) {
      const textDecoder = new TextDecoderStream();
      this.readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
      this.reader = textDecoder.readable.getReader();

      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;

          if (value) {
            lineBuffer += value;
            // Processa linhas completas terminadas em \r\n ou \n
            const lines = lineBuffer.split(/\r?\n/);
            lineBuffer = lines.pop(); // Mantém o fragmento incompleto

            for (const line of lines) {
              const cleanLine = line.trim();
              if (cleanLine) {
                this.handleIncomingLine(cleanLine);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[WebSerial] Erro no loop de leitura:', err);
      } finally {
        if (this.reader) {
          try {
            this.reader.releaseLock();
          } catch {}
          this.reader = null;
        }
      }
    }

    this.disconnect();
  }

  handleIncomingLine(rawLine) {
    // 1. Notifica observadores da linha pura para visualização no terminal
    this.onLineCallbacks.forEach(cb => cb(rawLine));

    // 2. Tenta fazer parse do formato JSON enviado pelo ESP32 ou Arduino
    // Suporta JSON puro {"vazao_lmin":0.00...} ou com prefixo de timestamp da Arduino IDE (ex: "18:11:02.734 -> {...}")
    let parsed = null;
    let jsonTarget = rawLine;
    const jsonStart = rawLine.indexOf('{');
    const jsonEnd = rawLine.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      jsonTarget = rawLine.slice(jsonStart, jsonEnd + 1);
      try {
        parsed = JSON.parse(jsonTarget);
      } catch {}
    } else if (rawLine.includes(',')) {
      const parts = rawLine.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        const flow = parseFloat(parts[0]);
        const total = parseFloat(parts[1]);
        if (!isNaN(flow) && !isNaN(total)) {
          parsed = { vazao_lmin: flow, litros_totais: total, status: 'normal', dispositivo: 'arduino' };
        }
      }
    }

    if (parsed) {
      this.lastReading = parsed;
      this.onReadingCallbacks.forEach(cb => cb(parsed, rawLine));

      // 3. Encaminha para o backend persistir no SQLite e atualizar alarmes
      SghApi.sendTelemetryReading({ linha_bruta: rawLine }).catch(err => {
        console.warn('[WebSerial] Erro ao sincronizar leitura com servidor:', err);
      });
    }
  }

  async disconnect() {
    this.isConnected = false;

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {}
      this.reader = null;
    }

    if (this.readableStreamClosed) {
      try {
        await this.readableStreamClosed.catch(() => {});
      } catch {}
      this.readableStreamClosed = null;
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch {}
      this.port = null;
    }

    this.notifyStatus(false, null, null);
    console.log('[WebSerial] Desconectado.');
  }
}

export const webSerial = new WebSerialManager();
