import { SghApi } from './api.js';
import { webSerial } from './webSerial.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Elementos do Cabeçalho e Relógio
  const clockDisplay = document.getElementById('clockDisplay');
  const serialStatusDot = document.getElementById('serialStatusDot');
  const serialStatusText = document.getElementById('serialStatusText');
  const userNameBadge = document.getElementById('userNameBadge');
  const btnLogout = document.getElementById('btnLogout');
  const btnBackup = document.getElementById('btnBackup');
  const btnOpenSettings = document.getElementById('btnOpenSettings');

  // Banner de Simulação & Modo Demonstração
  const simulationBanner = document.getElementById('simulationBanner');
  const simScenarioSelect = document.getElementById('simScenarioSelect');
  const btnToggleSim = document.getElementById('btnToggleSim');
  const btnSimTestAlert = document.getElementById('btnSimTestAlert');
  const btnSimPulse = document.getElementById('btnSimPulse');
  const btnExitDemoMode = document.getElementById('btnExitDemoMode');

  // Elementos dos Cards
  const valFlow = document.getElementById('valFlow');
  const badgeFlowStatus = document.getElementById('badgeFlowStatus');
  const flowPulseIndicator = document.getElementById('flowPulseIndicator');
  const valTotalLiters = document.getElementById('valTotalLiters');
  const valTotalM3 = document.getElementById('valTotalM3');
  const valTodayLiters = document.getElementById('valTodayLiters');
  const valTotalCost = document.getElementById('valTotalCost');
  const valTariffApplied = document.getElementById('valTariffApplied');
  const valSerialPortName = document.getElementById('valSerialPortName');
  const valSensorHealth = document.getElementById('valSensorHealth');
  const valLastReadingTime = document.getElementById('valLastReadingTime');

  // Gráfico
  const flowChartCanvas = document.getElementById('flowChart');
  const btnPauseChart = document.getElementById('btnPauseChart');
  const windowButtons = document.querySelectorAll('.btn-toggle[data-window]');

  // Alertas
  const alertsContainer = document.getElementById('alertsContainer');
  const badgeActiveAlertsCount = document.getElementById('badgeActiveAlertsCount');
  const btnResolveAllAlerts = document.getElementById('btnResolveAllAlerts');

  // Tabela Histórica
  const historyPeriodSelect = document.getElementById('historyPeriodSelect');
  const btnRefreshHistory = document.getElementById('btnRefreshHistory');
  const historyTableBody = document.getElementById('historyTableBody');
  const paginationInfo = document.getElementById('paginationInfo');
  const btnPrevPage = document.getElementById('btnPrevPage');
  const btnNextPage = document.getElementById('btnNextPage');

  // Central de Dispositivos Plug & Play (Arduino & ESP32)
  const deviceAvatarIcon = document.getElementById('deviceAvatarIcon');
  const deviceHubName = document.getElementById('deviceHubName');
  const deviceHubBadge = document.getElementById('deviceHubBadge');
  const deviceHubMeta = document.getElementById('deviceHubMeta');
  const btnAutoDetect = document.getElementById('btnAutoDetect');
  const btnWebSerialDash = document.getElementById('btnWebSerialDash');
  const btnOpenFirmwareModal = document.getElementById('btnOpenFirmwareModal');
  const deviceChipsContainer = document.getElementById('deviceChipsContainer');

  // Modal de Guia de Firmware e Diagrama de Pinos
  const firmwareModal = document.getElementById('firmwareModal');
  const btnCloseFirmwareModal = document.getElementById('btnCloseFirmwareModal');
  const btnCloseFirmwareGuide = document.getElementById('btnCloseFirmwareGuide');
  const tabFirmwareArduino = document.getElementById('tabFirmwareArduino');
  const tabFirmwareEsp32 = document.getElementById('tabFirmwareEsp32');
  const tabFirmwareFaq = document.getElementById('tabFirmwareFaq');
  const firmwarePanelArduino = document.getElementById('firmwarePanelArduino');
  const firmwarePanelEsp32 = document.getElementById('firmwarePanelEsp32');
  const firmwarePanelFaq = document.getElementById('firmwarePanelFaq');
  const btnCopyArduinoCode = document.getElementById('btnCopyArduinoCode');
  const btnCopyEsp32Code = document.getElementById('btnCopyEsp32Code');
  const codeArduinoSnippet = document.getElementById('codeArduinoSnippet');
  const codeEsp32Snippet = document.getElementById('codeEsp32Snippet');

  // Modal de Configurações
  const settingsModal = document.getElementById('settingsModal');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const btnCancelSettings = document.getElementById('btnCancelSettings');
  const settingsForm = document.getElementById('settingsForm');
  const cfgPerfilHardware = document.getElementById('cfgPerfilHardware');
  const cfgBaudRate = document.getElementById('cfgBaudRate');
  const cfgPortaSelect = document.getElementById('cfgPortaSelect');
  const btnTestPortConnection = document.getElementById('btnTestPortConnection');
  const portConnectionFeedback = document.getElementById('portConnectionFeedback');

  // Config inputs
  const cfgTarifaM3 = document.getElementById('cfgTarifaM3');
  const cfgCalibracao = document.getElementById('cfgCalibracao');
  const cfgMaxVazao = document.getElementById('cfgMaxVazao');
  const cfgTempoContinuo = document.getElementById('cfgTempoContinuo');
  const cfgHoraInicio = document.getElementById('cfgHoraInicio');
  const cfgHoraFim = document.getElementById('cfgHoraFim');
  const cfgPortaSerial = document.getElementById('cfgPortaSerial');

  // Estado da Aplicação
  let pollingIntervalMs = 1500;
  let pollingTimer = null;
  let isChartPaused = false;
  let chartMaxPoints = 30;
  let chartInstance = null;
  let historyCurrentPage = 1;
  let historyTotalPages = 1;
  let isFetchingStatus = false;

  // ============================================================================
  // 1. RELÓGIO DIGITAL
  // ============================================================================
  function updateClock() {
    const now = new Date();
    if (clockDisplay) {
      clockDisplay.textContent = now.toLocaleTimeString('pt-BR');
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ============================================================================
  // 2. INICIALIZAÇÃO DO GRÁFICO (CHART.JS LOCAL)
  // ============================================================================
  function initChart() {
    if (typeof window.Chart === 'undefined') {
      console.error('Chart.js local não carregado.');
      return;
    }

    if (!flowChartCanvas) return;
    const ctx = flowChartCanvas.getContext('2d');
    if (!ctx) return;

    // Gradiente sob a linha
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(6, 182, 212, 0.45)');
    gradient.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

    chartInstance = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Vazão Instantânea (L/min)',
          data: [],
          borderColor: '#06b6d4',
          backgroundColor: gradient,
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointBackgroundColor: '#38bdf8'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 300
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(30, 41, 59, 0.5)'
            },
            ticks: {
              color: '#64748b',
              maxTicksLimit: 8,
              font: { family: 'monospace', size: 11 }
            }
          },
          y: {
            beginAtZero: true,
            suggestedMax: 15,
            grid: {
              color: 'rgba(30, 41, 59, 0.5)'
            },
            ticks: {
              color: '#94a3b8',
              font: { family: 'monospace', size: 11 },
              callback: function(val) {
                return val + ' L/m';
              }
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#94a3b8',
            bodyColor: '#38bdf8',
            borderColor: '#1e293b',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                return 'Vazão: ' + Number(context.raw).toFixed(2) + ' L/min';
              }
            }
          }
        }
      }
    });
  }

  // Janelas de tempo do gráfico
  windowButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      windowButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const seconds = parseInt(btn.getAttribute('data-window') || '30', 10);
      chartMaxPoints = Math.max(15, Math.round(seconds / (pollingIntervalMs / 1000)));

      if (chartInstance && chartInstance.data.labels.length > chartMaxPoints) {
        chartInstance.data.labels = chartInstance.data.labels.slice(-chartMaxPoints);
        chartInstance.data.datasets[0].data = chartInstance.data.datasets[0].data.slice(-chartMaxPoints);
        chartInstance.update();
      }
    });
  });

  // Pausar / Retomar Gráfico
  btnPauseChart?.addEventListener('click', () => {
    isChartPaused = !isChartPaused;
    btnPauseChart.textContent = isChartPaused ? 'Retomar Fluxo' : 'Pausar Fluxo';
    btnPauseChart.classList.toggle('active', isChartPaused);
  });

  function addChartPoint(timeLabel, flowValue) {
    if (!chartInstance || isChartPaused) return;

    chartInstance.data.labels.push(timeLabel);
    chartInstance.data.datasets[0].data.push(flowValue);

    if (chartInstance.data.labels.length > chartMaxPoints) {
      chartInstance.data.labels.shift();
      chartInstance.data.datasets[0].data.shift();
    }

    chartInstance.update('none');
  }

  // ============================================================================
  // 3. POLLING E ATUALIZAÇÃO EM TEMPO REAL
  // ============================================================================
  async function fetchStatus() {
    if (isFetchingStatus) return;
    isFetchingStatus = true;

    try {
      const response = await SghApi.getStatus();
      if (!response || !response.sucesso) return;

      const d = response.dados;

      // Usuário autenticado
      if (d.usuario_conectado && userNameBadge) {
        userNameBadge.textContent = d.usuario_conectado;
      }

      // Card 1: Vazão
      if (valFlow) valFlow.textContent = d.vazao_lmin.toFixed(2);
      updateFlowBadge(d.vazao_lmin, d.status_badge);

      // Card 2: Consumo
      if (valTotalLiters) {
        valTotalLiters.textContent = Number(d.consumo_total_litros).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      if (valTotalM3) {
        valTotalM3.textContent = Number(d.consumo_total_m3).toFixed(4) + ' m³';
      }
      if (valTodayLiters) {
        valTodayLiters.textContent = Number(d.consumo_hoje_litros).toFixed(1) + ' L';
      }

      // Card 3: Financeiro
      if (valTotalCost) {
        valTotalCost.textContent = Number(d.custo_total_reais).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      if (valTariffApplied) {
        valTariffApplied.textContent = 'R$ ' + Number(d.tarifa_aplicada_m3).toFixed(2).replace('.', ',') + ' / m³';
      }

      // Card 4: Estado do Sistema e Dispositivo Identificado
      if (valSerialPortName) {
        if (d.modo_simulacao) {
          valSerialPortName.textContent = 'Simulador Ativo';
        } else if (d.dispositivo_nome) {
          valSerialPortName.textContent = `${d.dispositivo_nome} (${d.porta_ativa})`;
        } else {
          valSerialPortName.textContent = d.porta_ativa || 'USB';
        }
      }
      if (valSensorHealth) {
        valSensorHealth.textContent = d.sensor_saude === 'normal' ? 'Operacional' : (d.sensor_saude === 'atencao' ? 'Atenção' : 'Desconectado');
        valSensorHealth.style.color = d.sensor_saude === 'normal' ? 'var(--success)' : (d.sensor_saude === 'atencao' ? 'var(--warning)' : 'var(--danger)');
      }

      if (d.ultima_leitura && valLastReadingTime) {
        const dateObj = new Date(d.ultima_leitura);
        valLastReadingTime.textContent = dateObj.toLocaleTimeString('pt-BR');
      }

      // Central de Dispositivos (Plug & Play Arduino & ESP32)
      if (deviceHubName) {
        deviceHubName.textContent = d.modo_simulacao ? 'Simulador Hidráulico Ativo' : (d.dispositivo_nome || 'Microcontrolador USB');
      }

      if (deviceHubBadge) {
        if (d.modo_simulacao) {
          deviceHubBadge.textContent = 'Modo Simulação';
          deviceHubBadge.className = 'state-badge badge-warning';
        } else if (d.conexao_serial === 'conectado') {
          deviceHubBadge.textContent = 'Conectado & Transmitindo';
          deviceHubBadge.className = 'state-badge badge-normal';
        } else {
          deviceHubBadge.textContent = 'Desconectado';
          deviceHubBadge.className = 'state-badge badge-danger';
        }
      }

      if (deviceAvatarIcon) {
        if (d.modo_simulacao) {
          deviceAvatarIcon.className = 'device-avatar-icon esp32';
        } else if (d.conexao_serial === 'conectado') {
          if (d.dispositivo_tipo === 'arduino') {
            deviceAvatarIcon.className = 'device-avatar-icon arduino';
          } else if (d.dispositivo_tipo === 'esp32') {
            deviceAvatarIcon.className = 'device-avatar-icon esp32';
          } else {
            deviceAvatarIcon.className = 'device-avatar-icon esp32';
          }
        } else {
          deviceAvatarIcon.className = 'device-avatar-icon disconnected';
        }
      }

      if (deviceHubMeta) {
        if (d.modo_simulacao) {
          deviceHubMeta.textContent = `Simulação de ${d.cenario_simulacao || 'fluxo'} ativa. Alterne para Hardware Real para ler Arduino ou ESP32.`;
        } else if (d.conexao_serial === 'conectado') {
          deviceHubMeta.textContent = `Porta: ${d.porta_ativa} • Taxa: ${d.taxa_transmissao || 115200} bps • Sensor YF-S201 Ativo (7.5 pulsos/L)`;
        } else {
          deviceHubMeta.textContent = 'Nenhum Arduino ou ESP32 conectado. Conecte o cabo USB ao computador ou clique em Auto-Detectar.';
        }
      }

      // Status Pill do Header
      if (serialStatusDot && serialStatusText) {
        if (d.modo_simulacao) {
          serialStatusDot.className = 'status-dot simulating';
          serialStatusText.textContent = 'Modo Simulação';
          if (simulationBanner) simulationBanner.style.display = 'flex';
          if (simScenarioSelect) simScenarioSelect.value = d.cenario_simulacao || 'torneira';
        } else if (d.conexao_serial === 'conectado') {
          serialStatusDot.className = 'status-dot connected';
          const devLabel = d.dispositivo_tipo === 'arduino' ? 'Arduino' : (d.dispositivo_tipo === 'esp32' ? 'ESP32' : 'Hardware');
          serialStatusText.textContent = `${devLabel} Conectado (${d.porta_ativa})`;
          if (simulationBanner) simulationBanner.style.display = 'none';
        } else {
          serialStatusDot.className = 'status-dot disconnected';
          serialStatusText.textContent = 'Microcontrolador Desconectado';
          if (simulationBanner) simulationBanner.style.display = 'none';
        }
      }

      // Adiciona ponto no gráfico
      const nowTimeStr = new Date().toLocaleTimeString('pt-BR');
      addChartPoint(nowTimeStr, d.vazao_lmin);

      // Atualiza badge de contagem de alertas
      if (badgeActiveAlertsCount) {
        badgeActiveAlertsCount.textContent = d.alertas_ativos_count + ' Ativos';
        badgeActiveAlertsCount.className = d.alertas_ativos_count > 0 ? 'state-badge badge-danger' : 'state-badge badge-normal';
      }

    } catch (err) {
      console.warn('Erro ao atualizar status:', err);
      if (serialStatusDot && serialStatusText) {
        serialStatusDot.className = 'status-dot disconnected';
        serialStatusText.textContent = 'Falha de Conexão';
      }
    } finally {
      isFetchingStatus = false;
    }
  }

  function updateFlowBadge(flow, statusText) {
    if (!badgeFlowStatus || !flowPulseIndicator) return;

    if (statusText === 'Sensor desconectado') {
      badgeFlowStatus.className = 'state-badge badge-danger';
      badgeFlowStatus.textContent = 'Desconectado';
      flowPulseIndicator.textContent = 'Sem sinal';
      flowPulseIndicator.style.color = 'var(--danger)';
    } else if (flow > 30) {
      badgeFlowStatus.className = 'state-badge badge-danger';
      badgeFlowStatus.textContent = 'Ruptura / Fluxo Crítico';
      flowPulseIndicator.textContent = 'Fluxo severo!';
      flowPulseIndicator.style.color = 'var(--danger)';
    } else if (flow > 18) {
      badgeFlowStatus.className = 'state-badge badge-warning';
      badgeFlowStatus.textContent = 'Fluxo Alto';
      flowPulseIndicator.textContent = 'Uso intenso';
      flowPulseIndicator.style.color = 'var(--warning)';
    } else if (flow > 0.1) {
      badgeFlowStatus.className = 'state-badge badge-info';
      badgeFlowStatus.textContent = 'Em Consumo';
      flowPulseIndicator.textContent = 'Fluxo ativo';
      flowPulseIndicator.style.color = 'var(--cyan-primary)';
    } else {
      badgeFlowStatus.className = 'state-badge badge-normal';
      badgeFlowStatus.textContent = 'Repouso (Normal)';
      flowPulseIndicator.textContent = 'Sem fluxo';
      flowPulseIndicator.style.color = 'var(--text-dim)';
    }
  }

  function startPolling() {
    fetchStatus();
    pollingTimer = setInterval(fetchStatus, pollingIntervalMs);
  }

  // ============================================================================
  // 4. CENTRAL DE ALERTAS (ZERO-SLOP: APENAS EVENTOS REAIS DA REDE)
  // ============================================================================
  async function loadAlerts() {
    if (!alertsContainer) return;
    try {
      const response = await SghApi.getAlerts();
      if (!response || !response.sucesso) return;

      const ativos = response.dados.ativos || [];
      if (ativos.length === 0) {
        if (btnResolveAllAlerts) btnResolveAllAlerts.style.display = 'none';
        alertsContainer.innerHTML = `
          <div style="text-align: center; color: var(--text-dim); padding: 2.2rem 1rem; font-size: 0.85rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span style="color: #94a3b8; font-weight: 500;">Nenhum alerta ativo. Sistema hidráulico em operação normal.</span>
          </div>
        `;
        return;
      }

      if (btnResolveAllAlerts) btnResolveAllAlerts.style.display = 'inline-block';

      alertsContainer.innerHTML = ativos.map(function(a) {
        const timeStr = new Date(a.timestamp).toLocaleString('pt-BR');
        return `
          <div class="alert-item ${a.severidade}">
            <div class="alert-item-header">
              <span class="alert-item-title">[${a.severidade.toUpperCase()}] ${a.tipo.replace(/_/g, ' ')}</span>
              <span class="alert-item-time">${timeStr}</span>
            </div>
            <p class="alert-item-desc">${a.descricao}</p>
            <div class="alert-actions-row">
              <button class="btn-secondary btn-resolve-alert" data-id="${a.id}" style="font-size: 0.75rem; padding: 0.25rem 0.6rem;">
                Resolver & Finalizar
              </button>
            </div>
          </div>
        `;
      }).join('');

      document.querySelectorAll('.btn-resolve-alert').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          if (id) {
            await SghApi.acknowledgeAlert(parseInt(id, 10), 'resolvido');
            loadAlerts();
            fetchStatus();
          }
        });
      });

    } catch (err) {
      console.warn('Erro ao carregar alertas:', err);
    }
  }

  btnResolveAllAlerts?.addEventListener('click', async () => {
    btnResolveAllAlerts.disabled = true;
    try {
      await SghApi.clearAllAlerts(false);
      showToast('Todos os alertas foram marcados como resolvidos.', 'success');
      await loadAlerts();
      await fetchStatus();
    } catch {
      showToast('Erro ao resolver alertas.', 'danger');
    } finally {
      btnResolveAllAlerts.disabled = false;
    }
  });

  // ============================================================================
  // 5. HISTÓRICO DE CONSUMO COM PAGINAÇÃO
  // ============================================================================
  async function loadHistory(page = 1) {
    if (!historyTableBody) return;
    historyCurrentPage = page;
    const periodo = historyPeriodSelect ? historyPeriodSelect.value : 'hoje';

    try {
      const response = await SghApi.getHistory(page, 10, periodo);
      if (!response || !response.sucesso) return;

      const itens = response.dados.itens;
      const paginacao = response.dados.paginacao;
      historyTotalPages = paginacao.totalPaginas;

      if (!itens || itens.length === 0) {
        historyTableBody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">
              Nenhuma medição registrada para o período selecionado.
            </td>
          </tr>
        `;
      } else {
        historyTableBody.innerHTML = itens.map(function(item) {
          const time = new Date(item.timestamp).toLocaleTimeString('pt-BR');
          const date = new Date(item.timestamp).toLocaleDateString('pt-BR');
          return `
            <tr>
              <td><strong>${time}</strong> <span style="color: var(--text-dim); font-size: 0.75rem;">${date}</span></td>
              <td>${item.vazao_lmin.toFixed(2)}</td>
              <td>+${item.litros_incrementais.toFixed(3)} L</td>
              <td>${item.m3_acumulados.toFixed(4)} m³</td>
              <td>R$ ${item.custo_estimado.toFixed(2).replace('.', ',')}</td>
              <td>
                <span style="font-size: 0.75rem; padding: 0.15rem 0.4rem; border-radius: 4px; background: ${item.origem === 'simulado' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)'}; color: ${item.origem === 'simulado' ? '#fde68a' : '#86efac'};">
                  ${item.origem === 'simulado' ? 'SIM' : 'REAL'}
                </span>
              </td>
            </tr>
          `;
        }).join('');
      }

      if (paginationInfo) {
        paginationInfo.textContent = `Página ${paginacao.paginaAtual} de ${paginacao.totalPaginas} (${paginacao.totalRegistros} leituras)`;
      }
      if (btnPrevPage) btnPrevPage.disabled = historyCurrentPage <= 1;
      if (btnNextPage) btnNextPage.disabled = historyCurrentPage >= historyTotalPages;

    } catch (err) {
      console.warn('Erro ao carregar histórico:', err);
    }
  }

  historyPeriodSelect?.addEventListener('change', () => loadHistory(1));
  btnRefreshHistory?.addEventListener('click', () => loadHistory(historyCurrentPage));

  btnPrevPage?.addEventListener('click', () => {
    if (historyCurrentPage > 1) {
      loadHistory(historyCurrentPage - 1);
    }
  });

  btnNextPage?.addEventListener('click', () => {
    if (historyCurrentPage < historyTotalPages) {
      loadHistory(historyCurrentPage + 1);
    }
  });

  // ============================================================================
  // 6. CONTROLE DE SIMULAÇÃO & MODO DEMONSTRAÇÃO
  // ============================================================================
  simScenarioSelect?.addEventListener('change', async () => {
    const selected = simScenarioSelect.value;
    await SghApi.setSimulationScenario(selected);
    showToast(`Cenário simulado alterado para: ${selected.replace('_', ' ')}`, 'info');
    fetchStatus();
  });

  btnToggleSim?.addEventListener('click', async () => {
    const res = await SghApi.toggleSimulation();
    if (res && res.sucesso) {
      btnToggleSim.textContent = res.simulacaoAtiva ? 'Pausar Simulação' : 'Retomar Simulação';
      showToast(res.simulacaoAtiva ? 'Simulação em execução.' : 'Simulação pausada.', 'info');
      fetchStatus();
      loadHistory(1);
    }
  });

  // Disparar Alerta Simulado em Tempo Real
  btnSimTestAlert?.addEventListener('click', async () => {
    btnSimTestAlert.disabled = true;
    try {
      showToast('Disparando alerta de teste simulado...', 'info');
      await SghApi.triggerTestAlert('vazamento');
      showToast('Alerta simulado gerado! Inspecione a Central de Alertas.', 'danger');
      await loadAlerts();
      await fetchStatus();
    } catch (err) {
      showToast('Aviso ao disparar alerta: ' + err.message, 'warning');
    } finally {
      setTimeout(() => { btnSimTestAlert.disabled = false; }, 800);
    }
  });

  // Injetar Pulso de Vazão Rápido
  btnSimPulse?.addEventListener('click', async () => {
    btnSimPulse.disabled = true;
    try {
      showToast('Pulso de vazão (+5L) injetado na simulação!', 'info');
      await SghApi.injectFlowPulse(5.0);
      await fetchStatus();
      await loadHistory(1);
    } catch (err) {
      showToast('Aviso ao injetar pulso: ' + err.message, 'warning');
    } finally {
      setTimeout(() => { btnSimPulse.disabled = false; }, 1000);
    }
  });

  // Sair do Modo Demonstração
  btnExitDemoMode?.addEventListener('click', async () => {
    showToast('Encerrando demonstração...', 'info');
    await SghApi.exitDemoMode();
    window.location.replace('/login.html?exit_demo=true');
  });

  // Notificação toast moderna (sem usar window.alert/window.confirm bloqueados em iframes)
  function showToast(message, type = 'info') {
    let toast = document.getElementById('sghToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sghToast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #1e293b;
        color: #f8fafc;
        padding: 12px 20px;
        border-radius: 8px;
        border: 1px solid #334155;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        font-size: 0.9rem;
        z-index: 9999;
        transition: all 0.3s ease;
        opacity: 0;
        transform: translateY(10px);
      `;
      document.body.appendChild(toast);
    }

    if (type === 'success') {
      toast.style.borderColor = 'var(--success)';
      toast.style.background = '#064e3b';
      toast.style.color = '#a7f3d0';
    } else if (type === 'danger') {
      toast.style.borderColor = 'var(--danger)';
      toast.style.background = '#7f1d1d';
      toast.style.color = '#fecaca';
    } else {
      toast.style.borderColor = 'var(--cyan-primary)';
      toast.style.background = '#131f3d';
      toast.style.color = '#e0f2fe';
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(toast.dismissTimer);
    toast.dismissTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 4000);
  }

  // ============================================================================
  // 7. BACKUP DO BANCO SQLITE
  // ============================================================================
  btnBackup?.addEventListener('click', async () => {
    try {
      btnBackup.setAttribute('disabled', 'true');
      const res = await SghApi.createBackup();
      showToast('Backup SQLite gerado com sucesso localmente!', 'success');
    } catch (err) {
      showToast('Falha ao gerar backup: ' + err.message, 'danger');
    } finally {
      btnBackup.removeAttribute('disabled');
    }
  });

  // ============================================================================
  // 8. LOGOUT SEGURO E IMEDIATO
  // ============================================================================
  btnLogout?.addEventListener('click', async () => {
    try {
      btnLogout.setAttribute('disabled', 'true');
      btnLogout.style.opacity = '0.5';
      if (SghApi.isDemoMode()) {
        await SghApi.exitDemoMode();
      } else {
        await SghApi.logout();
      }
    } catch (err) {
      console.warn('Erro na requisição de logout:', err);
    } finally {
      sessionStorage.removeItem('sgh_session_token');
      sessionStorage.removeItem('sgh_demo_mode');
      window.location.replace('/login.html?exit_demo=true');
    }
  });

  // ============================================================================
  // 9. CENTRAL DE DISPOSITIVOS E AUTO-DETECÇÃO (ARDUINO & ESP32)
  // ============================================================================
  async function loadAvailableDevices() {
    try {
      const res = await SghApi.getDevices();
      if (!res || !res.sucesso) return;

      const devices = res.dispositivos || [];
      if (!deviceChipsContainer) return;

      if (devices.length === 0) {
        deviceChipsContainer.innerHTML = '<span style="color: var(--text-dim); font-size: 0.75rem;">Nenhum dispositivo USB detectado. Conecte seu Arduino ou ESP32 via cabo USB.</span>';
        return;
      }

      deviceChipsContainer.innerHTML = devices.map(dev => {
        const isCurrent = dev.conectado;
        const iconSymbol = dev.tipo === 'arduino' ? '⚡' : (dev.tipo === 'esp32' ? '📶' : '🔌');
        const badgeColor = dev.tipo === 'arduino' ? '#10b981' : (dev.tipo === 'esp32' ? '#06b6d4' : '#94a3b8');
        return `
          <button type="button" class="device-chip ${isCurrent ? 'active' : ''}" data-path="${dev.path}" data-baud="${dev.baudRecomendado}" title="${dev.descricao}">
            <span>${iconSymbol}</span>
            <strong>${dev.nomeAmigavel}</strong>
            <span style="color: ${badgeColor}; font-family: monospace;">(${dev.path})</span>
            ${isCurrent ? '<span style="color: #10b981; font-size: 0.7rem;">● Conectado</span>' : '<span style="color: var(--text-dim); font-size: 0.7rem;">Conectar</span>'}
          </button>
        `;
      }).join('');

      // Adiciona listener de clique direto nos chips de dispositivos
      deviceChipsContainer.querySelectorAll('.device-chip').forEach(chip => {
        chip.addEventListener('click', async () => {
          const path = chip.getAttribute('data-path');
          const baud = parseInt(chip.getAttribute('data-baud') || '115200', 10);
          if (!path) return;

          showToast(`Conectando a ${path}...`, 'info');
          try {
            const connectRes = await SghApi.connectSerial(path, baud);
            if (connectRes && connectRes.sucesso) {
              showToast(`Conectado com sucesso a ${path}!`, 'success');
              if (cfgPortaSerial) cfgPortaSerial.value = path;
              await fetchStatus();
              await loadAvailableDevices();
            } else {
              showToast(connectRes?.mensagem || `Falha ao conectar em ${path}.`, 'warning');
            }
          } catch (err) {
            showToast('Erro ao conectar dispositivo: ' + err.message, 'danger');
          }
        });
      });
    } catch (err) {
      console.warn('Erro ao carregar lista de dispositivos:', err);
    }
  }

  // Botão de Auto-Detecção Plug & Play
  btnAutoDetect?.addEventListener('click', async () => {
    if (btnAutoDetect) {
      btnAutoDetect.disabled = true;
      btnAutoDetect.textContent = 'Varrendo Portas USB...';
    }

    try {
      const res = await SghApi.autoDetectDevice();
      if (res && res.sucesso && res.dispositivo) {
        showToast(res.mensagem, 'success');
        if (cfgPortaSerial) cfgPortaSerial.value = res.dispositivo.path;
      } else {
        showToast((res && res.mensagem) || 'Nenhum Arduino ou ESP32 identificado automaticamente.', 'warning');
      }
      await fetchStatus();
      await loadAvailableDevices();
    } catch (err) {
      showToast('Erro durante auto-detecção: ' + err.message, 'danger');
    } finally {
      if (btnAutoDetect) {
        btnAutoDetect.disabled = false;
        btnAutoDetect.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
          </svg>
          Auto-Detectar
        `;
      }
    }
  });

  // Conexão direta via Web Serial no Dashboard
  btnWebSerialDash?.addEventListener('click', async () => {
    if (webSerial.isConnected) {
      await webSerial.disconnect();
      showToast('Dispositivo USB desconectado do navegador.', 'info');
      return;
    }

    if (!webSerial.isSupported()) {
      showToast('Seu navegador não suporta Web Serial API. Para conexão USB direta, utilize Google Chrome ou Microsoft Edge.', 'danger');
      return;
    }

    try {
      showToast('Selecione a porta USB do seu ESP32/Arduino na janela do navegador...', 'info');
      await webSerial.connect(115200);
      showToast('ESP32 / Arduino conectado com sucesso via Web Serial USB!', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });

  webSerial.onStatusChange(({ connected, error }) => {
    if (btnWebSerialDash) {
      if (connected) {
        btnWebSerialDash.textContent = '🔌 USB Conectado (Clique p/ Desconectar)';
        btnWebSerialDash.classList.remove('btn-primary');
        btnWebSerialDash.classList.add('btn-secondary');
      } else {
        btnWebSerialDash.textContent = '🔌 Conectar USB (Web Serial)';
        btnWebSerialDash.classList.remove('btn-secondary');
        btnWebSerialDash.classList.add('btn-primary');
      }
    }

    if (deviceHubBadge && connected) {
      deviceHubBadge.textContent = '● Web Serial Ativo';
      deviceHubBadge.className = 'state-badge badge-normal';
    }
    if (deviceHubName && connected) {
      deviceHubName.textContent = 'ESP32 / Arduino (Conectado via USB Web Serial)';
    }
    if (deviceAvatarIcon && connected) {
      deviceAvatarIcon.className = 'device-avatar-icon esp32';
    }

    if (error) {
      showToast(error, 'danger');
    }
  });

  let lastWebSerialHistoryTime = 0;
  webSerial.onReading((data) => {
    // Ao receber dados do WebSerial, atualiza o status instantaneamente
    fetchStatus();
    const now = Date.now();
    if (now - lastWebSerialHistoryTime > 8000) {
      lastWebSerialHistoryTime = now;
      loadHistory(historyCurrentPage);
    }
  });

  // ============================================================================
  // 10. MODAL DE CÓDIGO-FONTE E ESQUEMA DE LIGAÇÃO
  // ============================================================================
  btnOpenFirmwareModal?.addEventListener('click', () => {
    firmwareModal?.classList.add('active');
  });

  btnCloseFirmwareModal?.addEventListener('click', () => {
    firmwareModal?.classList.remove('active');
  });

  btnCloseFirmwareGuide?.addEventListener('click', () => {
    firmwareModal?.classList.remove('active');
  });

  tabFirmwareArduino?.addEventListener('click', () => {
    tabFirmwareArduino.classList.add('active');
    tabFirmwareEsp32?.classList.remove('active');
    tabFirmwareFaq?.classList.remove('active');
    if (firmwarePanelArduino) firmwarePanelArduino.style.display = 'block';
    if (firmwarePanelEsp32) firmwarePanelEsp32.style.display = 'none';
    if (firmwarePanelFaq) firmwarePanelFaq.style.display = 'none';
  });

  tabFirmwareEsp32?.addEventListener('click', () => {
    tabFirmwareEsp32.classList.add('active');
    tabFirmwareArduino?.classList.remove('active');
    tabFirmwareFaq?.classList.remove('active');
    if (firmwarePanelArduino) firmwarePanelArduino.style.display = 'none';
    if (firmwarePanelEsp32) firmwarePanelEsp32.style.display = 'block';
    if (firmwarePanelFaq) firmwarePanelFaq.style.display = 'none';
  });

  tabFirmwareFaq?.addEventListener('click', () => {
    tabFirmwareFaq.classList.add('active');
    tabFirmwareArduino?.classList.remove('active');
    tabFirmwareEsp32?.classList.remove('active');
    if (firmwarePanelArduino) firmwarePanelArduino.style.display = 'none';
    if (firmwarePanelEsp32) firmwarePanelEsp32.style.display = 'none';
    if (firmwarePanelFaq) firmwarePanelFaq.style.display = 'block';
  });

  btnCopyArduinoCode?.addEventListener('click', async () => {
    const code = codeArduinoSnippet?.textContent || '';
    try {
      await navigator.clipboard.writeText(code);
      showToast('Código para Arduino copiado com sucesso!', 'success');
    } catch {
      showToast('Selecione e copie o código manualmente.', 'info');
    }
  });

  btnCopyEsp32Code?.addEventListener('click', async () => {
    const code = codeEsp32Snippet?.textContent || '';
    try {
      await navigator.clipboard.writeText(code);
      showToast('Código para ESP32 copiado com sucesso!', 'success');
    } catch {
      showToast('Selecione e copie o código manualmente.', 'info');
    }
  });

  // ============================================================================
  // 11. MODAL DE CONFIGURAÇÕES
  // ============================================================================
  btnOpenSettings?.addEventListener('click', async () => {
    try {
      const res = await SghApi.getConfig();
      if (res && res.sucesso) {
        const c = res.dados;
        if (cfgTarifaM3) cfgTarifaM3.value = c.tarifa_m3 || '4.50';
        if (cfgCalibracao) cfgCalibracao.value = c.fator_calibracao || '7.5';
        if (cfgMaxVazao) cfgMaxVazao.value = c.vazao_maxima_lmin || '30.0';
        if (cfgTempoContinuo) cfgTempoContinuo.value = c.tempo_fluxo_continuo_min || '45';
        if (cfgHoraInicio) cfgHoraInicio.value = c.horario_inativo_inicio || '01:00';
        if (cfgHoraFim) cfgHoraFim.value = c.horario_inativo_fim || '05:00';
        
        const currentPort = c.porta_serial || 'COM3';
        if (cfgPortaSerial) cfgPortaSerial.value = currentPort;
        if (cfgPortaSelect) {
          const match = Array.from(cfgPortaSelect.options).some(opt => opt.value === currentPort);
          cfgPortaSelect.value = match ? currentPort : 'custom';
        }

        if (portConnectionFeedback) {
          portConnectionFeedback.textContent = 'Selecione na lista ou digite a porta atribuída pelo SO ao Arduino ou ESP32.';
          portConnectionFeedback.style.color = 'var(--text-dim)';
        }
      }
      settingsModal?.classList.add('active');
    } catch (err) {
      console.error('Erro ao abrir configurações:', err);
    }
  });

  btnCloseSettings?.addEventListener('click', () => settingsModal?.classList.remove('active'));
  btnCancelSettings?.addEventListener('click', () => settingsModal?.classList.remove('active'));

  // Sincronização do Perfil de Hardware
  cfgPerfilHardware?.addEventListener('change', () => {
    const profile = cfgPerfilHardware.value;
    if (profile === 'arduino_9600' && cfgBaudRate) {
      cfgBaudRate.value = '9600';
    } else if ((profile === 'arduino_115200' || profile === 'esp32') && cfgBaudRate) {
      cfgBaudRate.value = '115200';
    }
  });

  // Sincronização da seleção manual de porta
  cfgPortaSelect?.addEventListener('change', () => {
    const selected = cfgPortaSelect.value;
    if (selected && selected !== 'custom' && cfgPortaSerial) {
      cfgPortaSerial.value = selected;
    } else if (selected === 'custom' && cfgPortaSerial) {
      cfgPortaSerial.focus();
    }
  });

  cfgPortaSerial?.addEventListener('input', () => {
    const typed = cfgPortaSerial.value.trim();
    if (cfgPortaSelect) {
      const match = Array.from(cfgPortaSelect.options).some(opt => opt.value === typed);
      cfgPortaSelect.value = match ? typed : 'custom';
    }
  });

  // Testar conexão direta com a porta selecionada manualmente
  btnTestPortConnection?.addEventListener('click', async () => {
    const porta = cfgPortaSerial?.value.trim();
    const baud = cfgBaudRate ? parseInt(cfgBaudRate.value, 10) : 115200;

    if (!porta) {
      showToast('Por favor, informe a porta serial manualmente.', 'danger');
      if (portConnectionFeedback) {
        portConnectionFeedback.textContent = 'Informe o nome da porta serial (ex: COM3, /dev/ttyUSB0).';
        portConnectionFeedback.style.color = 'var(--accent-red)';
      }
      return;
    }

    if (portConnectionFeedback) {
      portConnectionFeedback.textContent = `Tentando conectar a ${porta} (${baud} bps)...`;
      portConnectionFeedback.style.color = 'var(--accent-cyan)';
    }

    try {
      const res = await SghApi.connectSerial(porta, baud);
      if (res && res.sucesso) {
        if (portConnectionFeedback) {
          portConnectionFeedback.textContent = `Conectado com sucesso à porta ${porta}!`;
          portConnectionFeedback.style.color = 'var(--accent-green)';
        }
        showToast(`Conectado com sucesso à porta ${porta}!`, 'success');
        await fetchStatus();
        await loadAvailableDevices();
      } else {
        const msg = (res && res.mensagem) || 'Falha ao conectar na porta selecionada.';
        if (portConnectionFeedback) {
          portConnectionFeedback.textContent = `Aviso: ${msg}`;
          portConnectionFeedback.style.color = 'var(--accent-yellow)';
        }
        showToast(msg, 'warning');
      }
    } catch (err) {
      if (portConnectionFeedback) {
        portConnectionFeedback.textContent = `Erro ao conectar: ${err.message}`;
        portConnectionFeedback.style.color = 'var(--accent-red)';
      }
      showToast('Erro ao testar porta serial: ' + err.message, 'danger');
    }
  });

  // Salvar configurações
  settingsForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const baud = cfgBaudRate ? parseInt(cfgBaudRate.value, 10) : 115200;
    const payload = {
      tarifa_m3: parseFloat(cfgTarifaM3.value),
      fator_calibracao: parseFloat(cfgCalibracao.value),
      vazao_maxima_lmin: parseFloat(cfgMaxVazao.value),
      tempo_fluxo_continuo_min: parseInt(cfgTempoContinuo.value, 10),
      horario_inativo_inicio: cfgHoraInicio.value,
      horario_inativo_fim: cfgHoraFim.value,
      porta_serial: cfgPortaSerial.value.trim()
    };

    try {
      await SghApi.updateConfig(payload);
      if (cfgPortaSerial.value.trim()) {
        await SghApi.connectSerial(cfgPortaSerial.value.trim(), baud);
      }
      settingsModal?.classList.remove('active');
      await fetchStatus();
      await loadAvailableDevices();
      showToast('Configurações salvas e aplicadas com sucesso!', 'success');
    } catch (err) {
      showToast('Erro ao salvar configurações: ' + err.message, 'danger');
    }
  });

  // ============================================================================
  // INICIALIZAÇÃO E IDENTIFICAÇÃO DE SESSÃO / MODO DEMO
  // ============================================================================
  const urlParams = new URLSearchParams(window.location.search);
  const isDemoUrl = urlParams.get('demo') === 'true';
  const isDemoStorage = SghApi.isDemoMode();

  if (isDemoUrl || isDemoStorage) {
    sessionStorage.setItem('sgh_demo_mode', 'true');
    if (userNameBadge) {
      userNameBadge.innerHTML = '<span style="color:#38bdf8; font-weight:600; display:inline-flex; align-items:center; gap:0.35rem;"><span style="width:7px; height:7px; border-radius:50%; background:#38bdf8; display:inline-block; box-shadow:0 0 6px #38bdf8;"></span>Visitante (Demo)</span>';
    }
    if (simulationBanner) {
      simulationBanner.style.display = 'flex';
    }
    SghApi.setSimulationScenario(simScenarioSelect ? simScenarioSelect.value : 'torneira').catch(() => {});
  } else {
    try {
      const sess = await SghApi.checkSession();
      if (sess && sess.autenticado && sess.usuario) {
        if (sess.usuario.role === 'demo') {
          sessionStorage.setItem('sgh_demo_mode', 'true');
          if (userNameBadge) {
            userNameBadge.innerHTML = '<span style="color:#38bdf8; font-weight:600;">Visitante (Demo)</span>';
          }
          if (simulationBanner) simulationBanner.style.display = 'flex';
        } else if (userNameBadge) {
          userNameBadge.textContent = sess.usuario.username || 'Operador';
        }
      }
    } catch {}
  }

  initChart();
  startPolling();
  loadAlerts();
  loadHistory(1);
  loadAvailableDevices();
  setInterval(loadAlerts, 5000);
  setInterval(loadAvailableDevices, 8000);
});

