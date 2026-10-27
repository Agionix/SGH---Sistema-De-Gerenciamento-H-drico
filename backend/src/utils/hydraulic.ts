/**
 * ==============================================================================
 * SGH — Sistema de Gerenciamento Hidráulico
 * Módulo de Lógica Hidráulica e Cálculos Financeiros
 * ==============================================================================
 */

/**
 * Calcula a vazão em Litros por Minuto (L/min)
 * Fórmula: Q = (frequência de pulsos [Hz] * 60) / fator de calibração
 * 
 * @param pulses Quantidade de pulsos contados no intervalo
 * @param deltaSeconds Intervalo de tempo da medição em segundos (ex: 1.0)
 * @param calibrationFactor Fator de calibração do sensor (ex: 7.5 para YF-S201, 5.5 para TF-S201)
 * @returns Vazão instantânea em L/min arredondada com precisão
 */
export function calculateFlowRate(
  pulses: number,
  deltaSeconds: number,
  calibrationFactor: number
): number {
  if (deltaSeconds <= 0 || calibrationFactor <= 0 || pulses <= 0) {
    return 0.0;
  }
  const frequencyHz = pulses / deltaSeconds;
  const flowLmin = (frequencyHz * 60.0) / calibrationFactor;
  return Number(Math.max(0, flowLmin).toFixed(2));
}

/**
 * Calcula o volume incremental em litros escoado no intervalo
 * 
 * @param flowLmin Vazão média no intervalo em L/min
 * @param deltaSeconds Intervalo em segundos
 * @returns Litros consumidos no intervalo
 */
export function calculateIncrementalVolume(
  flowLmin: number,
  deltaSeconds: number
): number {
  if (flowLmin <= 0 || deltaSeconds <= 0) {
    return 0.0;
  }
  const liters = (flowLmin / 60.0) * deltaSeconds;
  return Number(Math.max(0, liters).toFixed(4));
}

/**
 * Converte litros para metros cúbicos (1 m³ = 1000 L)
 */
export function litersToCubicMeters(liters: number): number {
  if (liters <= 0) return 0.0;
  return Number((liters / 1000.0).toFixed(4));
}

/**
 * Calcula o custo estimado em Reais (R$) com base no volume em m³ e tarifa configurada
 * 
 * @param volumeM3 Volume consumido em metros cúbicos
 * @param tariffPerM3 Tarifa em R$/m³
 * @returns Custo financeiro estimado em R$ (2 casas decimais)
 */
export function calculateCost(volumeM3: number, tariffPerM3: number): number {
  if (volumeM3 <= 0 || tariffPerM3 <= 0) {
    return 0.0;
  }
  const cost = volumeM3 * tariffPerM3;
  return Number(Math.max(0, cost).toFixed(2));
}

/**
 * Resultado do processamento de leitura serial com proteção contra reinicialização
 */
export interface Esp32AccumulationResult {
  isReset: boolean;
  incrementalLiters: number;
  newCumulativeLiters: number;
}

/**
 * Trata o contador total recebido do ESP32 para evitar perda ou duplicação de dados,
 * mesmo se o microcontrolador reiniciar e o seu contador local zerar.
 * 
 * @param incomingEsp32Total Litros totais reportados no payload serial atual
 * @param lastEsp32Total Último valor reportado pelo ESP32 na leitura anterior
 * @param currentSystemCumulative Total acumulado permanente registrado no sistema/banco
 */
export function processEsp32Total(
  incomingEsp32Total: number,
  lastEsp32Total: number,
  currentSystemCumulative: number
): Esp32AccumulationResult {
  const safeIncoming = Math.max(0, Number(incomingEsp32Total) || 0);

  // Primeira leitura após inicialização do backend
  if (lastEsp32Total < 0) {
    return {
      isReset: false,
      incrementalLiters: 0,
      newCumulativeLiters: currentSystemCumulative
    };
  }

  // Detecta reinicialização do ESP32: o valor recebido é menor que o anterior
  // com margem de segurança de 0.2L para evitar falso positivo por ruído
  if (safeIncoming < (lastEsp32Total - 0.2)) {
    // O microcontrolador reiniciou. O novo consumo incremental é o próprio incomingEsp32Total
    const incremental = safeIncoming;
    const newCumulative = Number((currentSystemCumulative + incremental).toFixed(3));
    return {
      isReset: true,
      incrementalLiters: incremental,
      newCumulativeLiters: newCumulative
    };
  }

  // Leitura normal incremental
  const incremental = Math.max(0, Number((safeIncoming - lastEsp32Total).toFixed(4)));
  const newCumulative = Number((currentSystemCumulative + incremental).toFixed(3));

  return {
    isReset: false,
    incrementalLiters: incremental,
    newCumulativeLiters: newCumulative
  };
}

/**
 * Validador e normalizador do payload recebido pela porta serial (ESP32 ou Arduino)
 */
export interface SerialPayload {
  vazao_lmin: number;
  litros_totais: number;
  status: string;
  dispositivo?: 'arduino' | 'esp32' | 'generico';
}

export function parseAndValidateSerialJson(rawLine: string): SerialPayload | null {
  if (!rawLine || typeof rawLine !== 'string') return null;

  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  // 1. FORMATO JSON (Padrão ESP32 e Arduino com ArduinoJson)
  // Suporta JSON puro {"vazao_lmin":0.0...} ou com prefixo de timestamp da Arduino IDE (ex: "18:11:02.734 -> {...}")
  let jsonStr = trimmed;
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    jsonStr = trimmed.slice(jsonStart, jsonEnd + 1);
  }

  if (jsonStr.startsWith('{') && jsonStr.endsWith('}')) {
    try {
      const data = JSON.parse(jsonStr);

      // Normalização de chaves flexíveis (ESP32 e Arduino)
      const rawFlow = data.vazao_lmin ?? data.vazao ?? data.flow ?? data.flow_rate;
      const rawTotal = data.litros_totais ?? data.litros ?? data.total ?? data.total_liters;
      const rawStatus = data.status ?? 'normal';
      const rawDevice = data.dispositivo ?? data.device;

      // Validação numérica rigorosa
      if (
        typeof rawFlow !== 'number' ||
        typeof rawTotal !== 'number' ||
        isNaN(rawFlow) ||
        isNaN(rawTotal) ||
        rawFlow < 0 ||
        rawTotal < 0
      ) {
        return null;
      }

      let dispositivo: 'arduino' | 'esp32' | 'generico' = 'generico';
      if (typeof rawDevice === 'string') {
        const devLower = rawDevice.toLowerCase();
        if (devLower.includes('arduino')) dispositivo = 'arduino';
        else if (devLower.includes('esp')) dispositivo = 'esp32';
      }

      return {
        vazao_lmin: Number(rawFlow.toFixed(2)),
        litros_totais: Number(rawTotal.toFixed(2)),
        status: String(rawStatus).slice(0, 50),
        dispositivo
      };
    } catch {
      return null;
    }
  }

  // 2. FORMATO CSV SIMPLES (Padrão comum em Arduino Uno/Nano: "vazao,total" ou "vazao,total,status")
  // Exemplo: "3.46,10.50" ou "3.46,10.50,normal"
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      const flow = parseFloat(parts[0]);
      const total = parseFloat(parts[1]);
      const status = parts[2] ? parts[2].slice(0, 50) : 'normal';

      if (!isNaN(flow) && !isNaN(total) && flow >= 0 && total >= 0) {
        return {
          vazao_lmin: Number(flow.toFixed(2)),
          litros_totais: Number(total.toFixed(2)),
          status,
          dispositivo: 'arduino'
        };
      }
    }
  }

  // 3. FORMATO CHAVE-VALOR (Exemplo: "VAZAO:3.46;TOTAL:10.5" ou "FLOW:3.46,TOTAL:10.5")
  const kvMatch = trimmed.match(/(?:VAZAO|FLOW)[:=]([0-9.]+)[;, ]*(?:TOTAL|LITROS)[:=]([0-9.]+)/i);
  if (kvMatch) {
    const flow = parseFloat(kvMatch[1]);
    const total = parseFloat(kvMatch[2]);
    if (!isNaN(flow) && !isNaN(total) && flow >= 0 && total >= 0) {
      return {
        vazao_lmin: Number(flow.toFixed(2)),
        litros_totais: Number(total.toFixed(2)),
        status: 'normal',
        dispositivo: 'arduino'
      };
    }
  }

  return null;
}

