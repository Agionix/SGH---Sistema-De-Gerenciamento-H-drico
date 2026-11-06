import { SghApi } from './api.js';
import { webSerial } from './webSerial.js';

document.addEventListener('DOMContentLoaded', () => {
  // Elementos do Hero Status
  const heroDeviceIcon = document.getElementById('heroDeviceIcon');
  const heroDeviceTitle = document.getElementById('heroDeviceTitle');
  const heroDeviceSub = document.getElementById('heroDeviceSub');
  const heroStatusBadge = document.getElementById('heroStatusBadge');
  const btnDisconnectAll = document.getElementById('btnDisconnectAll');

  // Leituras ao Vivo
  const liveFlowVal = document.getElementById('liveFlowVal');
  const livePulseText = document.getElementById('livePulseText');
  const livePortVal = document.getElementById('livePortVal');
  const liveBaudVal = document.getElementById('liveBaudVal');
  const liveTotalVal = document.getElementById('liveTotalVal');
  const liveCostVal = document.getElementById('liveCostVal');
  const liveLastTimeText = document.getElementById('liveLastTimeText');

  // Banners e Alertas
  const iframeNoticeBanner = document.getElementById('iframeNoticeBanner');
  const connectionErrorBanner = document.getElementById('connectionErrorBanner');
  const errorBannerTitle = document.getElementById('errorBannerTitle');
  const errorBannerDesc = document.getElementById('errorBannerDesc');
  const dynamicApiUrl = document.getElementById('dynamicApiUrl');

  // Preenche a URL da API dinamicamente para o código do ESP32 com a URL atual (seja Vercel ou local)
  if (dynamicApiUrl) {
    dynamicApiUrl.textContent = window.location.origin;
  }
  const snippetPageEsp32Wifi = document.getElementById('snippetPageEsp32Wifi');
  if (snippetPageEsp32Wifi) {
    snippetPageEsp32Wifi.innerHTML = snippetPageEsp32Wifi.innerHTML.replace(
      /https:\/\/ais-dev-[^"'\s]+/g,
      `${window.location.origin}/api/telemetria/leitura`
    );
  }

  // Detecta se está em iframe (AI Studio preview)
  const isInIframe = window.self !== window.top;
  if (iframeNoticeBanner) {
    iframeNoticeBanner.style.display = isInIframe ? 'flex' : 'none';
  }

  // Controles Web Serial
  const webSerialBrowserBadge = document.getElementById('webSerialBrowserBadge');
  const webSerialBaudSelect = document.getElementById('webSerialBaudSelect');
  const btnWebSerialConnect = document.getElementById('btnWebSerialConnect');
  const btnWebSerialDisconnect = document.getElementById('btnWebSerialDisconnect');
  const btnQuickTestReading = document.getElementById('btnQuickTestReading');
  const webSerialFeedback = document.getElementById('webSerialFeedback');

  // Terminal Serial
  const serialTerminalBody = document.getElementById('serialTerminalBody');
  const chkAutoScroll = document.getElementById('chkAutoScroll');
  const chkShowTimestamp = document.getElementById('chkShowTimestamp');
  const btnClearTerminal = document.getElementById('btnClearTerminal');
  const btnCopyTerminal = document.getElementById('btnCopyTerminal');
  const formManualInject = document.getElementById('formManualInject');
  const inputManualLine = document.getElementById('inputManualLine');

  // Controles de Servidor Local
  const btnAutoDetectFull = document.getElementById('btnAutoDetectFull');
  const btnRefreshList = document.getElementById('btnRefreshList');
  const detectedDevicesList = document.getElementById('detectedDevicesList');
  const manualConnectForm = document.getElementById('manualConnectForm');
  const selectPortPreset = document.getElementById('selectPortPreset');
  const inputManualPort = document.getElementById('inputManualPort');
  const selectBaudRate = document.getElementById('selectBaudRate');
  const selectHardwareFamily = document.getElementById('selectHardwareFamily');
  const manualConnectFeedback = document.getElementById('manualConnectFeedback');

  function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; max-width: 420px;';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const bgColors = {
      success: '#065f46',
      danger: '#991b1b',
      warning: '#92400e',
      info: '#0e7490'
    };
    const borders = {
      success: '#10b981',
      danger: '#ef4444',
      warning: '#f59e0b',
      info: '#06b6d4'
    };

    toast.style.cssText = `background: ${bgColors[type] || '#1e293b'}; border: 1px solid ${borders[type] || '#475569'}; color: #fff; padding: 12px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 500; box-shadow: 0 10px 25px rgba(0,0,0,0.5); opacity: 0; transform: translateY(10px); transition: all 0.3s ease; line-height: 1.4;`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  // Exibe erro na interface apenas quando a conexão falhar
  function showErrorBanner(title, description) {
    if (connectionErrorBanner && errorBannerTitle && errorBannerDesc) {
      errorBannerTitle.textContent = title;
      errorBannerDesc.textContent = description;
      connectionErrorBanner.style.display = 'flex';
    }
  }

  function hideErrorBanner() {
    if (connectionErrorBanner) {
      connectionErrorBanner.style.display = 'none';
    }
  }

  // Verifica suporte à Web Serial API
  if (webSerialBrowserBadge) {
    if (webSerial.isSupported()) {
      webSerialBrowserBadge.textContent = '● Web Serial Suportada (Chrome/Edge)';
      webSerialBrowserBadge.className = 'state-badge badge-normal';
    } else {
      webSerialBrowserBadge.textContent = 'Navegador Sem Suporte Web Serial';
      webSerialBrowserBadge.className = 'state-badge badge-danger';
      webSerialBrowserBadge.title = 'Para conexão USB direta, use o Google Chrome ou Microsoft Edge no computador.';
    }
  }

  // Adiciona linha ao terminal serial
  function appendTerminalLine(text, type = 'normal') {
    if (!serialTerminalBody) return;

    const lineEl = document.createElement('div');
    lineEl.className = 'terminal-line';

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

    if (chkShowTimestamp && chkShowTimestamp.checked) {
      const timeSpan = document.createElement('span');
      timeSpan.className = 't-time';
      timeSpan.textContent = timeStr + ' -> ';
      lineEl.appendChild(timeSpan);
    }

    const contentSpan = document.createElement('span');
    if (type === 'err') contentSpan.className = 't-err';
    else if (type === 'info') contentSpan.className = 't-info';
    else if (type === 'json' || text.includes('{')) contentSpan.className = 't-json';

    contentSpan.textContent = text;
    lineEl.appendChild(contentSpan);

    serialTerminalBody.appendChild(lineEl);

    while (serialTerminalBody.children.length > 250) {
      serialTerminalBody.removeChild(serialTerminalBody.firstChild);
    }

    if (chkAutoScroll && chkAutoScroll.checked) {
      serialTerminalBody.scrollTop = serialTerminalBody.scrollHeight;
    }
  }

  // Callbacks do WebSerial
  webSerial.onLine((line) => {
    appendTerminalLine(line, 'json');
  });

  webSerial.onReading((data) => {
    hideErrorBanner();
    if (liveFlowVal) {
      liveFlowVal.innerHTML = `${(data.vazao_lmin || 0).toFixed(2)} <span style="font-size: 0.85rem; color: var(--text-muted);">L/min</span>`;
    }
    if (livePulseText) {
      livePulseText.textContent = (data.vazao_lmin || 0) > 0 ? 'Fluxo ativo detectado no sensor' : 'Sem fluxo de água no momento';
      livePulseText.style.color = (data.vazao_lmin || 0) > 0 ? 'var(--cyan-primary)' : 'var(--text-dim)';
    }
    if (liveTotalVal) {
      liveTotalVal.innerHTML = `${(data.litros_totais || 0).toFixed(2)} <span style="font-size: 0.85rem; color: var(--text-muted);">L</span>`;
    }
    if (liveCostVal) {
      const m3 = (data.litros_totais || 0) / 1000;
      const cost = m3 * 4.5;
      liveCostVal.textContent = `R$ ${cost.toFixed(2).replace('.', ',')}`;
    }
    if (liveLastTimeText) {
      const dt = new Date();
      liveLastTimeText.textContent = `Última leitura: ${dt.toLocaleTimeString('pt-BR')}`;
    }
  });

  webSerial.onStatusChange(({ connected, error }) => {
    if (connected) {
      hideErrorBanner();
      if (btnWebSerialConnect) {
        btnWebSerialConnect.textContent = '🔌 USB Conectado via Navegador';
        btnWebSerialConnect.classList.remove('btn-primary');
        btnWebSerialConnect.classList.add('btn-secondary');
        btnWebSerialConnect.disabled = true;
      }
      if (btnWebSerialDisconnect) {
        btnWebSerialDisconnect.style.display = 'inline-block';
      }
      if (webSerialFeedback) {
        webSerialFeedback.innerHTML = `<span style="color: #10b981; font-weight: 600;">● Conexão Web Serial aberta! Lendo telemetria USB do ESP32 / Arduino.</span>`;
      }
      if (heroStatusBadge) {
        heroStatusBadge.textContent = 'USB Web Serial Conectado';
        heroStatusBadge.className = 'state-badge badge-normal';
      }
      if (heroDeviceTitle) {
        heroDeviceTitle.textContent = 'ESP32 / Arduino (Conectado via Web Serial USB)';
      }
      if (heroDeviceIcon) {
        heroDeviceIcon.className = 'device-avatar-icon esp32';
      }
      if (livePortVal) {
        livePortVal.textContent = 'Navegador USB';
      }
      appendTerminalLine('[SISTEMA] Porta USB aberta com sucesso pelo navegador. Lendo dados...', 'info');
    } else {
      if (btnWebSerialConnect) {
        btnWebSerialConnect.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
          🔌 Conectar via Cabo USB (Web Serial)
        `;
        btnWebSerialConnect.classList.remove('btn-secondary');
        btnWebSerialConnect.classList.add('btn-primary');
        btnWebSerialConnect.disabled = false;
      }
      if (btnWebSerialDisconnect) {
        btnWebSerialDisconnect.style.display = 'none';
      }

      if (error) {
        showErrorBanner('Aviso ao Conectar USB', error);
        if (webSerialFeedback) {
          webSerialFeedback.innerHTML = `<span style="color: #ef4444; font-weight: 600;">${error}</span>`;
        }
        appendTerminalLine(`[ERRO CONEXÃO] ${error}`, 'err');
      } else {
        if (webSerialFeedback) {
          webSerialFeedback.textContent = '';
        }
      }
    }
  });

  // Botão Conectar Web Serial
  btnWebSerialConnect?.addEventListener('click', async () => {
    hideErrorBanner();
    const baud = parseInt(webSerialBaudSelect?.value || '115200', 10);
    appendTerminalLine(`[SISTEMA] Solicitando porta USB com taxa ${baud} bps...`, 'info');

    try {
      await webSerial.connect(baud);
      showToast('Conectado ao dispositivo USB com sucesso!', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });

  // Botão Desconectar Web Serial
  btnWebSerialDisconnect?.addEventListener('click', async () => {
    try {
      await webSerial.disconnect();
      showToast('Dispositivo USB desconectado do navegador.', 'info');
      appendTerminalLine('[SISTEMA] Porta USB fechada.', 'info');
    } catch (err) {
      showToast('Erro ao desconectar: ' + err.message, 'danger');
    }
  });

  // Botão Testar Leitura Imediata
  btnQuickTestReading?.addEventListener('click', async () => {
    const sampleLine = '{"vazao_lmin":3.75,"litros_totais":2.84,"status":"normal","dispositivo":"esp32"}';
    appendTerminalLine(sampleLine, 'json');

    try {
      const res = await SghApi.sendTelemetryReading({ linha_bruta: sampleLine });
      if (res && res.sucesso) {
        showToast('Leitura de teste do ESP32 processada com sucesso!', 'success');
        hideErrorBanner();
        await refreshLiveStatus();
      }
    } catch (err) {
      showToast('Erro ao testar leitura: ' + err.message, 'danger');
    }
  });

  // Limpar e Copiar Terminal
  btnClearTerminal?.addEventListener('click', () => {
    if (serialTerminalBody) {
      serialTerminalBody.innerHTML = '<div class="terminal-line" style="color: #64748b;">[SISTEMA] Terminal limpo.</div>';
    }
  });

  btnCopyTerminal?.addEventListener('click', async () => {
    if (!serialTerminalBody) return;
    try {
      const text = serialTerminalBody.innerText;
      await navigator.clipboard.writeText(text);
      showToast('Log do terminal copiado!', 'success');
    } catch {
      showToast('Não foi possível copiar o log.', 'warning');
    }
  });

  // Envio / Teste manual de linha
  formManualInject?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const line = inputManualLine?.value.trim();
    if (!line) return;

    appendTerminalLine(line, 'json');

    try {
      const res = await SghApi.sendTelemetryReading({ linha_bruta: line });
      if (res && res.sucesso) {
        showToast('Leitura processada com sucesso!', 'success');
        hideErrorBanner();
        await refreshLiveStatus();
      } else {
        showToast(res?.mensagem || 'Formato não reconhecido.', 'warning');
        appendTerminalLine(`[AVISO BACKEND] ${res?.mensagem}`, 'err');
      }
    } catch (err) {
      showToast('Erro ao enviar leitura: ' + err.message, 'danger');
      appendTerminalLine(`[ERRO ENVIO] ${err.message}`, 'err');
    }
  });

  // Consulta e renderiza o estado da conexão USB em tempo real
  async function refreshLiveStatus() {
    try {
      const res = await SghApi.getSerialStatus();
      if (!res || !res.sucesso || !res.dados) return;

      const d = res.dados;
      const isConnected = !!d.connected || webSerial.isConnected;

      if (heroStatusBadge) {
        if (isConnected) {
          heroStatusBadge.textContent = 'Conectado & Operacional';
          heroStatusBadge.className = 'state-badge badge-normal';
        } else {
          heroStatusBadge.textContent = 'Aguardando Leitura';
          heroStatusBadge.className = 'state-badge badge-danger';
        }
      }

      if (heroDeviceTitle) {
        if (isConnected) {
          const devName = d.dispositivoAtual?.nomeAmigavel || (d.tipoDetectado === 'arduino' ? 'Arduino Uno / Nano' : 'ESP32 DevKit');
          const port = webSerial.isConnected ? 'Web Serial USB' : (d.portPath || 'USB / Wi-Fi');
          heroDeviceTitle.textContent = `${devName} (${port})`;
        } else {
          heroDeviceTitle.textContent = 'Aguardando Leitura do Dispositivo...';
        }
      }

      if (heroDeviceSub) {
        if (isConnected) {
          heroDeviceSub.textContent = `Taxa: ${d.baudRate || 115200} bps • Sensor de Vazão YF-S201 calibrado a 7.5 pulsos/L`;
        } else {
          heroDeviceSub.textContent = 'Sensor YF-S201 • Suporta ESP32 (USB / Wi-Fi) e Arduino (Uno / Nano / Mega)';
        }
      }

      if (heroDeviceIcon) {
        if (isConnected) {
          if (d.tipoDetectado === 'arduino' || d.dispositivoAtual?.tipo === 'arduino') {
            heroDeviceIcon.className = 'device-avatar-icon arduino';
          } else {
            heroDeviceIcon.className = 'device-avatar-icon esp32';
          }
        } else {
          heroDeviceIcon.className = 'device-avatar-icon disconnected';
        }
      }

      if (!webSerial.isConnected) {
        if (liveFlowVal) {
          liveFlowVal.innerHTML = `${(d.lastFlowLmin || 0).toFixed(2)} <span style="font-size: 0.85rem; color: var(--text-muted);">L/min</span>`;
        }

        if (livePulseText) {
          if (isConnected) {
            livePulseText.textContent = d.lastFlowLmin > 0 ? 'Fluxo ativo detectado no sensor' : 'Sem fluxo de água no momento';
            livePulseText.style.color = d.lastFlowLmin > 0 ? 'var(--cyan-primary)' : 'var(--text-dim)';
          } else {
            livePulseText.textContent = 'Sem fluxo detectado';
            livePulseText.style.color = 'var(--text-dim)';
          }
        }

        if (livePortVal) {
          livePortVal.textContent = d.portPath || '--';
        }

        if (liveBaudVal) {
          liveBaudVal.textContent = `${d.baudRate || 115200} bps`;
        }

        if (liveTotalVal) {
          liveTotalVal.innerHTML = `${(d.lastTotalLiters || 0).toFixed(2)} <span style="font-size: 0.85rem; color: var(--text-muted);">L</span>`;
        }

        if (liveCostVal) {
          const cost = d.totalCostEstimated || 0;
          liveCostVal.textContent = `R$ ${cost.toFixed(2).replace('.', ',')}`;
        }

        if (liveLastTimeText) {
          if (d.lastReadingTime) {
            const dt = new Date(d.lastReadingTime);
            liveLastTimeText.textContent = `Última leitura: ${dt.toLocaleTimeString('pt-BR')}`;
          } else {
            liveLastTimeText.textContent = 'Sem leituras recentes';
          }
        }
      }
    } catch (err) {
      console.warn('Erro ao consultar status:', err);
    }
  }

  // Lista portas e dispositivos detectados no computador
  async function loadUsbDevices() {
    if (!detectedDevicesList) return;

    try {
      const res = await SghApi.getDevices();
      if (!res || !res.sucesso || !res.dispositivos) return;

      const devices = res.dispositivos;
      if (devices.length === 0) {
        detectedDevicesList.innerHTML = `
          <div style="padding: 0.85rem; background: #0f172a; border: 1px dashed var(--border-color); border-radius: 8px; font-size: 0.775rem; color: var(--text-muted); text-align: center;">
            Nenhuma porta detectada pelo backend.<br>
            <span style="font-size: 0.725rem; color: var(--cyan-primary);">Use o botão Conectar via Cabo USB pelo navegador acima!</span>
          </div>
        `;
        return;
      }

      detectedDevicesList.innerHTML = devices.map(dev => {
        const isCurrent = dev.conectado;
        const iconSymbol = dev.tipo === 'arduino' ? '⚡' : (dev.tipo === 'esp32' ? '📶' : '🔌');
        const badgeColor = dev.tipo === 'arduino' ? '#10b981' : (dev.tipo === 'esp32' ? '#06b6d4' : '#94a3b8');
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; border: 1px solid ${isCurrent ? '#10b981' : 'var(--border-color)'}; padding: 0.65rem 0.85rem; border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 1.1rem;">${iconSymbol}</span>
              <div>
                <strong style="font-size: 0.825rem; color: var(--text-main);">${dev.nomeAmigavel}</strong>
                <div style="font-size: 0.7rem; color: var(--text-dim);">
                  Porta: <span style="font-family: monospace; color: ${badgeColor}; font-weight: bold;">${dev.path}</span>
                </div>
              </div>
            </div>
            <div>
              ${isCurrent ? `
                <span class="state-badge badge-normal" style="font-size: 0.7rem;">● Conectado</span>
              ` : `
                <button type="button" class="btn-secondary btn-quick-connect" data-path="${dev.path}" data-baud="${dev.baudRecomendado}" style="font-size: 0.7rem; padding: 0.25rem 0.6rem; width: auto;">
                  Conectar
                </button>
              `}
            </div>
          </div>
        `;
      }).join('');

      detectedDevicesList.querySelectorAll('.btn-quick-connect').forEach(btn => {
        btn.addEventListener('click', async () => {
          const path = btn.getAttribute('data-path');
          const baud = parseInt(btn.getAttribute('data-baud') || '115200', 10);
          if (!path) return;

          btn.textContent = 'Conectando...';
          btn.disabled = true;

          try {
            const resConnect = await SghApi.connectSerial(path, baud);
            if (resConnect && resConnect.sucesso) {
              showToast(`Conectado com sucesso a ${path}!`, 'success');
              if (inputManualPort) inputManualPort.value = path;
            } else {
              showToast(resConnect?.mensagem || `Falha ao conectar em ${path}.`, 'warning');
            }
          } catch (err) {
            showToast('Erro ao conectar: ' + err.message, 'danger');
          } finally {
            await refreshLiveStatus();
            await loadUsbDevices();
          }
        });
      });
    } catch (err) {
      console.warn('Erro ao carregar portas:', err);
    }
  }

  btnAutoDetectFull?.addEventListener('click', async () => {
    btnAutoDetectFull.disabled = true;
    btnAutoDetectFull.textContent = 'Varrendo Portas no Computador...';

    try {
      const res = await SghApi.autoDetectDevice();
      if (res && res.sucesso && res.dispositivo) {
        showToast(res.mensagem, 'success');
        if (inputManualPort) inputManualPort.value = res.dispositivo.path;
      } else {
        showToast(res?.mensagem || 'Nenhum dispositivo encontrado pelo servidor.', 'warning');
      }
    } catch (err) {
      showToast('Erro durante auto-detecção: ' + err.message, 'danger');
    } finally {
      btnAutoDetectFull.disabled = false;
      btnAutoDetectFull.textContent = '⚡ Auto-Detectar Portas no PC';
      await refreshLiveStatus();
      await loadUsbDevices();
    }
  });

  btnRefreshList?.addEventListener('click', loadUsbDevices);

  btnDisconnectAll?.addEventListener('click', async () => {
    try {
      if (webSerial.isConnected) {
        await webSerial.disconnect();
      }
      await SghApi.disconnectSerial();
      showToast('Desconectado com sucesso.', 'info');
      await refreshLiveStatus();
      await loadUsbDevices();
    } catch (err) {
      showToast('Erro ao desconectar: ' + err.message, 'danger');
    }
  });

  selectPortPreset?.addEventListener('change', () => {
    const val = selectPortPreset.value;
    if (val && val !== 'custom' && inputManualPort) {
      inputManualPort.value = val;
    } else if (val === 'custom' && inputManualPort) {
      inputManualPort.focus();
    }
  });

  inputManualPort?.addEventListener('input', () => {
    const typed = inputManualPort.value.trim();
    if (selectPortPreset) {
      const match = Array.from(selectPortPreset.options).some(o => o.value === typed);
      selectPortPreset.value = match ? typed : 'custom';
    }
  });

  manualConnectForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const porta = inputManualPort?.value.trim();
    const baud = parseInt(selectBaudRate?.value || '115200', 10);

    if (!porta) {
      showToast('Informe o nome da porta serial.', 'danger');
      return;
    }

    if (manualConnectFeedback) {
      manualConnectFeedback.textContent = `Conectando a ${porta} (${baud} bps)...`;
      manualConnectFeedback.style.color = 'var(--cyan-primary)';
    }

    try {
      const res = await SghApi.connectSerial(porta, baud);
      if (res && res.sucesso) {
        showToast(`Conectado à porta ${porta}!`, 'success');
        if (manualConnectFeedback) {
          manualConnectFeedback.textContent = `Conectado com sucesso a ${porta}!`;
          manualConnectFeedback.style.color = 'var(--success)';
        }
      } else {
        const msg = res?.mensagem || 'Falha ao conectar na porta selecionada.';
        showToast(msg, 'warning');
        if (manualConnectFeedback) {
          manualConnectFeedback.textContent = msg;
          manualConnectFeedback.style.color = 'var(--warning)';
        }
      }
    } catch (err) {
      showToast('Erro ao conectar: ' + err.message, 'danger');
      if (manualConnectFeedback) {
        manualConnectFeedback.textContent = 'Erro: ' + err.message;
        manualConnectFeedback.style.color = 'var(--danger)';
      }
    } finally {
      await refreshLiveStatus();
      await loadUsbDevices();
    }
  });

  // ============================================================================
  // ABAS PRINCIPAIS: CONEXÃO | CÓDIGOS C++ | DÚVIDAS & INSTALAÇÃO
  // ============================================================================
  const tabNavConnect = document.getElementById('tabNavConnect');
  const tabNavCodes = document.getElementById('tabNavCodes');
  const tabNavFaq = document.getElementById('tabNavFaq');
  const panelConnect = document.getElementById('panelConnect');
  const panelCodes = document.getElementById('panelCodes');
  const panelFaq = document.getElementById('panelFaq');

  tabNavConnect?.addEventListener('click', () => {
    tabNavConnect.classList.add('active');
    tabNavCodes?.classList.remove('active');
    tabNavFaq?.classList.remove('active');
    if (panelConnect) panelConnect.style.display = 'block';
    if (panelCodes) panelCodes.style.display = 'none';
    if (panelFaq) panelFaq.style.display = 'none';
  });

  tabNavCodes?.addEventListener('click', () => {
    tabNavCodes.classList.add('active');
    tabNavConnect?.classList.remove('active');
    tabNavFaq?.classList.remove('active');
    if (panelConnect) panelConnect.style.display = 'none';
    if (panelCodes) panelCodes.style.display = 'block';
    if (panelFaq) panelFaq.style.display = 'none';
  });

  tabNavFaq?.addEventListener('click', () => {
    tabNavFaq.classList.add('active');
    tabNavConnect?.classList.remove('active');
    tabNavCodes?.classList.remove('active');
    if (panelConnect) panelConnect.style.display = 'none';
    if (panelCodes) panelCodes.style.display = 'none';
    if (panelFaq) panelFaq.style.display = 'block';
  });

  // SUB-ABAS DE CÓDIGOS C++
  const tabCodeArduino = document.getElementById('tabCodeArduino');
  const tabCodeEsp32Serial = document.getElementById('tabCodeEsp32Serial');
  const tabCodeEsp32Wifi = document.getElementById('tabCodeEsp32Wifi');
  const codeBoxArduino = document.getElementById('codeBoxArduino');
  const codeBoxEsp32Serial = document.getElementById('codeBoxEsp32Serial');
  const codeBoxEsp32Wifi = document.getElementById('codeBoxEsp32Wifi');

  tabCodeArduino?.addEventListener('click', () => {
    tabCodeArduino.classList.add('active');
    tabCodeEsp32Serial?.classList.remove('active');
    tabCodeEsp32Wifi?.classList.remove('active');
    if (codeBoxArduino) codeBoxArduino.style.display = 'block';
    if (codeBoxEsp32Serial) codeBoxEsp32Serial.style.display = 'none';
    if (codeBoxEsp32Wifi) codeBoxEsp32Wifi.style.display = 'none';
  });

  tabCodeEsp32Serial?.addEventListener('click', () => {
    tabCodeEsp32Serial.classList.add('active');
    tabCodeArduino?.classList.remove('active');
    tabCodeEsp32Wifi?.classList.remove('active');
    if (codeBoxArduino) codeBoxArduino.style.display = 'none';
    if (codeBoxEsp32Serial) codeBoxEsp32Serial.style.display = 'block';
    if (codeBoxEsp32Wifi) codeBoxEsp32Wifi.style.display = 'none';
  });

  tabCodeEsp32Wifi?.addEventListener('click', () => {
    tabCodeEsp32Wifi.classList.add('active');
    tabCodeArduino?.classList.remove('active');
    tabCodeEsp32Serial?.classList.remove('active');
    if (codeBoxArduino) codeBoxArduino.style.display = 'none';
    if (codeBoxEsp32Serial) codeBoxEsp32Serial.style.display = 'none';
    if (codeBoxEsp32Wifi) codeBoxEsp32Wifi.style.display = 'block';
  });

  // BOTÕES DE CÓPIA DE CÓDIGO
  const btnCopyPageArduino = document.getElementById('btnCopyPageArduino');
  const btnCopyPageEsp32Serial = document.getElementById('btnCopyPageEsp32Serial');
  const btnCopyPageEsp32Wifi = document.getElementById('btnCopyPageEsp32Wifi');
  const snippetPageArduino = document.getElementById('snippetPageArduino');
  const snippetPageEsp32Serial = document.getElementById('snippetPageEsp32Serial');

  btnCopyPageArduino?.addEventListener('click', async () => {
    const text = snippetPageArduino?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      showToast('Código para Arduino copiado com sucesso!', 'success');
    } catch {
      showToast('Selecione e copie o código manualmente.', 'info');
    }
  });

  btnCopyPageEsp32Serial?.addEventListener('click', async () => {
    const text = snippetPageEsp32Serial?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      showToast('Código ESP32 (USB Serial) copiado com sucesso!', 'success');
    } catch {
      showToast('Selecione e copie o código manualmente.', 'info');
    }
  });

  btnCopyPageEsp32Wifi?.addEventListener('click', async () => {
    const text = snippetPageEsp32Wifi?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      showToast('Código ESP32 (Wi-Fi HTTP) copiado com sucesso!', 'success');
    } catch {
      showToast('Selecione e copie o código manualmente.', 'info');
    }
  });

  refreshLiveStatus();
  loadUsbDevices();
  setInterval(refreshLiveStatus, 1500);
  setInterval(loadUsbDevices, 6000);
});
