import { queryOne, run } from '../database/db.js';

export interface AlertNotification {
  tipo: string;
  severidade: 'baixa' | 'media' | 'alta' | 'critica';
  descricao: string;
  valor_detectado: number;
}

export class LeakDetectorService {
  private flowStartTimeMs: number | null = null;
  private continuousFlowAlertFired: boolean = false;
  private inactiveHoursAlertFired: boolean = false;
  private lastFlowRate: number = 0;
  private lastReadingTimestampMs: number = Date.now();

  /**
   * Avalia a leitura recebida e identifica anomalias ou vazamentos
   */
  public evaluateReading(vazaoLmin: number, timestampIso: string = new Date().toISOString()): AlertNotification[] {
    const alertsToTrigger: AlertNotification[] = [];
    const nowMs = Date.now();
    const currentDate = new Date(timestampIso);

    // Carrega regras configuradas no banco
    const cfgMaxVazao = Number(queryOne(`SELECT valor FROM configuracoes WHERE chave = 'vazao_maxima_lmin'`)?.valor || 30.0);
    const cfgLimiteMin = Number(queryOne(`SELECT valor FROM configuracoes WHERE chave = 'tempo_fluxo_continuo_min'`)?.valor || 45);
    const cfgHoraIni = queryOne(`SELECT valor FROM configuracoes WHERE chave = 'horario_inativo_inicio'`)?.valor || '01:00';
    const cfgHoraFim = queryOne(`SELECT valor FROM configuracoes WHERE chave = 'horario_inativo_fim'`)?.valor || '05:00';

    // 1. REGRA: Vazão excessiva / Ruptura de tubulação
    if (vazaoLmin > cfgMaxVazao) {
      alertsToTrigger.push({
        tipo: 'FLUXO_EXCESSIVO',
        severidade: 'critica',
        descricao: `Vazão crítica de ${vazaoLmin.toFixed(2)} L/min ultrapassou o limite seguro de ${cfgMaxVazao} L/min. Possível rompimento na tubulação!`,
        valor_detectado: vazaoLmin
      });
    }

    // 2. REGRA: Vazão contínua prolongada (ex: torneira esquecida aberta ou vazamento oculto)
    const thresholdFlow = 0.3; // Vazões acima de 0.3 L/min contam como fluxo contínuo
    if (vazaoLmin >= thresholdFlow) {
      if (this.flowStartTimeMs === null) {
        this.flowStartTimeMs = nowMs;
        this.continuousFlowAlertFired = false;
      } else {
        const continuousMinutes = (nowMs - this.flowStartTimeMs) / (1000 * 60);
        if (continuousMinutes >= cfgLimiteMin && !this.continuousFlowAlertFired) {
          alertsToTrigger.push({
            tipo: 'VAZAMENTO_CONTINUO',
            severidade: 'alta',
            descricao: `Fluxo de água ininterrupto há mais de ${Math.round(continuousMinutes)} minutos (vazão atual: ${vazaoLmin.toFixed(2)} L/min). Verifique torneiras, descargas ou tubulações embutidas.`,
            valor_detectado: vazaoLmin
          });
          this.continuousFlowAlertFired = true;
        }
      }
    } else {
      // Fluxo parou normalmente (vazão < threshold)
      this.flowStartTimeMs = null;
      this.continuousFlowAlertFired = false;
    }

    // 3. REGRA: Consumo em período noturno / inativo
    const currentHours = currentDate.getHours();
    const currentMinutes = currentDate.getMinutes();
    const [iniH, iniM] = cfgHoraIni.split(':').map(Number);
    const [fimH, fimM] = cfgHoraFim.split(':').map(Number);

    const currentMinutesOfDay = currentHours * 60 + currentMinutes;
    const startMinutesOfDay = iniH * 60 + iniM;
    const endMinutesOfDay = fimH * 60 + fimM;

    let isInactiveWindow = false;
    if (startMinutesOfDay <= endMinutesOfDay) {
      isInactiveWindow = currentMinutesOfDay >= startMinutesOfDay && currentMinutesOfDay <= endMinutesOfDay;
    } else {
      // Janela que passa da meia-noite (ex: 23:00 até 05:00)
      isInactiveWindow = currentMinutesOfDay >= startMinutesOfDay || currentMinutesOfDay <= endMinutesOfDay;
    }

    if (isInactiveWindow && vazaoLmin > 0.5) {
      if (!this.inactiveHoursAlertFired) {
        alertsToTrigger.push({
          tipo: 'CONSUMO_NOTURNO_ATIPICO',
          severidade: 'media',
          descricao: `Consumo detectado no horário de inatividade (${cfgHoraIni} às ${cfgHoraFim}): ${vazaoLmin.toFixed(2)} L/min.`,
          valor_detectado: vazaoLmin
        });
        this.inactiveHoursAlertFired = true;
      }
    } else if (!isInactiveWindow || vazaoLmin === 0) {
      this.inactiveHoursAlertFired = false;
    }

    // 4. REGRA: Queda brusca atípica após pico (golpe de aríete / anomalia de pressão)
    // Se a vazão caiu de > 20 L/min para 0 em menos de 1 segundo sem transição suave
    if (this.lastFlowRate > 22.0 && vazaoLmin === 0.0) {
      alertsToTrigger.push({
        tipo: 'QUEDA_BRUSCA_FLUXO',
        severidade: 'baixa',
        descricao: `Queda abrupta de fluxo detectada (de ${this.lastFlowRate.toFixed(2)} L/min para 0 L/min). Pode indicar fechamento violento de registro ou golpe de aríete.`,
        valor_detectado: this.lastFlowRate
      });
    }

    this.lastFlowRate = vazaoLmin;
    this.lastReadingTimestampMs = nowMs;

    // Registra os alertas encontrados no banco de dados
    for (const alert of alertsToTrigger) {
      this.recordAlertInDatabase(alert);
    }

    return alertsToTrigger;
  }

  /**
   * Grava alerta no banco evitando duplicações idênticas recentes
   */
  private recordAlertInDatabase(alert: AlertNotification) {
    const nowIso = new Date().toISOString();
    // Verifica se já existe um alerta ativo do mesmo tipo gerado nos últimos 5 minutos
    const recent = queryOne(
      `SELECT id FROM alertas 
       WHERE tipo = ? AND status = 'ativo' AND datetime(timestamp) >= datetime('now', '-5 minutes')`,
      [alert.tipo]
    );

    if (!recent) {
      run(
        `INSERT INTO alertas (timestamp, tipo, severidade, descricao, status, valor_detectado)
         VALUES (?, ?, ?, ?, 'ativo', ?)`,
        [nowIso, alert.tipo, alert.severidade, alert.descricao, alert.valor_detectado]
      );

      run(
        `INSERT INTO eventos_sistema (timestamp, tipo, mensagem, detalhe)
         VALUES (?, 'ALERTA', ?, ?)`,
        [nowIso, `[${alert.severidade.toUpperCase()}] ${alert.tipo}`, alert.descricao]
      );
    }
  }

  /**
   * Avalia a saúde da conexão do sensor físico
   */
  public checkSensorHealth(isConnectedSerial: boolean): 'normal' | 'atencao' | 'desconectado' {
    if (!isConnectedSerial) {
      return 'desconectado';
    }
    const elapsedSinceLastReading = Date.now() - this.lastReadingTimestampMs;
    if (elapsedSinceLastReading > 6000) {
      return 'atencao';
    }
    return 'normal';
  }
}

export const leakDetector = new LeakDetectorService();
