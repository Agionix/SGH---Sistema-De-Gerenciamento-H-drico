import { config } from '../config/index.js';
import { queryOne, run } from '../database/db.js';
import {
  calculateIncrementalVolume,
  calculateCost,
  litersToCubicMeters
} from '../utils/hydraulic.js';
import { leakDetector } from './leakDetector.js';

export type SimulationScenario = 'repouso' | 'torneira' | 'chuveiro' | 'vazamento_leve' | 'ruptura_grave';

export class SimulationService {
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private currentScenario: SimulationScenario = 'torneira';
  private cumulativeLiters: number = 0;
  private currentFlow: number = 0;
  private lastReadingTime: string | null = null;
  private tickIntervalMs: number = 1000;

  constructor() {
    this.loadInitialCumulative();
    if (config.simulationMode) {
      this.start();
    }
  }

  private loadInitialCumulative() {
    try {
      const lastRow = queryOne(
        `SELECT litros_acumulados FROM leituras ORDER BY id DESC LIMIT 1`
      );
      if (lastRow && typeof lastRow.litros_acumulados === 'number') {
        this.cumulativeLiters = lastRow.litros_acumulados;
      }
    } catch {
      this.cumulativeLiters = 0;
    }
  }

  public start(scenario?: SimulationScenario): void {
    if (scenario) {
      this.currentScenario = scenario;
    }
    if (this.isRunning) return;

    this.isRunning = true;
    console.log(`[SIMULACAO] Modo de simulação ativado no cenário: ${this.currentScenario}`);

    this.timer = setInterval(() => {
      this.step();
    }, this.tickIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.currentFlow = 0;
    console.log('[SIMULACAO] Modo de simulação desativado');
  }

  public toggle(): boolean {
    if (this.isRunning) {
      this.stop();
      return false;
    } else {
      this.start();
      return true;
    }
  }

  public setScenario(scenario: SimulationScenario): void {
    this.currentScenario = scenario;
    console.log(`[SIMULACAO] Cenário alterado para: ${scenario}`);
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  public getScenario(): SimulationScenario {
    return this.currentScenario;
  }

  public getCurrentStatus() {
    const tariffM3 = Number(queryOne(`SELECT valor FROM configuracoes WHERE chave = 'tarifa_m3'`)?.valor || 4.50);
    const m3 = litersToCubicMeters(this.cumulativeLiters);
    const cost = calculateCost(m3, tariffM3);

    return {
      active: this.isRunning,
      scenario: this.currentScenario,
      flowLmin: this.currentFlow,
      totalLiters: Number(this.cumulativeLiters.toFixed(2)),
      totalCostEstimated: cost,
      lastReadingTime: this.lastReadingTime
    };
  }

  private step(): void {
    const now = new Date();
    const nowIso = now.toISOString();
    const deltaSeconds = this.tickIntervalMs / 1000.0;

    // Gera vazão com pequenas variações realistas (ruído de ±2% a ±5%)
    let baseFlow = 0;
    switch (this.currentScenario) {
      case 'repouso':
        baseFlow = 0.0;
        break;
      case 'torneira':
        baseFlow = 4.5 + (Math.random() * 0.4 - 0.2); // ~4.3 a 4.7 L/min
        break;
      case 'chuveiro':
        baseFlow = 10.5 + (Math.random() * 1.0 - 0.5); // ~10.0 a 11.0 L/min
        break;
      case 'vazamento_leve':
        baseFlow = 0.85 + (Math.random() * 0.1 - 0.05); // ~0.80 a 0.90 L/min contínuo
        break;
      case 'ruptura_grave':
        baseFlow = 35.0 + (Math.random() * 3.0 - 1.5); // ~33.5 a 36.5 L/min
        break;
    }

    this.currentFlow = Number(Math.max(0, baseFlow).toFixed(2));
    this.lastReadingTime = nowIso;

    const incrementalLiters = calculateIncrementalVolume(this.currentFlow, deltaSeconds);
    this.cumulativeLiters += incrementalLiters;

    const tariffM3 = Number(queryOne(`SELECT valor FROM configuracoes WHERE chave = 'tarifa_m3'`)?.valor || 4.50);
    const m3Incremental = litersToCubicMeters(incrementalLiters);
    const custoIncremental = calculateCost(m3Incremental, tariffM3);
    const m3Total = litersToCubicMeters(this.cumulativeLiters);
    const custoAcumulado = calculateCost(m3Total, tariffM3);

    let status = 'normal';
    if (this.currentFlow > 30.0) {
      status = 'alerta_fluxo_alto';
    } else if (this.currentScenario === 'vazamento_leve') {
      status = 'possivel_vazamento';
    }

    // Avalia no detector de vazamento
    leakDetector.evaluateReading(this.currentFlow, nowIso);

    // Grava no banco com flag de origem 'simulado'
    run(
      `INSERT INTO leituras (
        timestamp, vazao_lmin, litros_incrementais, litros_acumulados,
        custo_incremental, custo_acumulado, status, origem
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'simulado')`,
      [
        nowIso,
        this.currentFlow,
        incrementalLiters,
        Number(this.cumulativeLiters.toFixed(2)),
        custoIncremental,
        custoAcumulado,
        status
      ]
    );
  }
}

export const simulationService = new SimulationService();
