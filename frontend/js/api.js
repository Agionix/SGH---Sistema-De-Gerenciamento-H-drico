/**
 * ==============================================================================
 * SGH — Sistema de Gerenciamento Hidráulico
 * Cliente de API HTTP (Fetch Puro, 100% Offline)
 * ==============================================================================
 */

const API_BASE = '/api';

// Estado local resiliente para o Modo Demonstração (caso o backend esteja off-line ou em servidor serverless frio)
const localDemoState = {
  flow: 4.5,
  totalLiters: 14.8,
  scenario: 'torneira',
  alerts: [
    {
      id: 991,
      timestamp: new Date().toISOString(),
      tipo: 'VAZAMENTO_CONTINUO',
      severidade: 'media',
      descricao: 'Demonstração: Fluxo contínuo verificado pelo algoritmo de análise',
      status: 'ativo',
      valor_detectado: '2.4 L/min'
    }
  ],
  history: []
};

export async function request(endpoint, options = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const isDemoActive = sessionStorage.getItem('sgh_demo_mode') === 'true';

  // Garante autenticação segura mesmo dentro de iframes ou navegadores que bloqueiam cookies 3P
  const savedToken = sessionStorage.getItem('sgh_session_token');
  if (savedToken) {
    defaultHeaders['Authorization'] = `Bearer ${savedToken}`;
  }

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {})
    },
    credentials: 'include' // Envia e recebe cookies HttpOnly de sessão
  };

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, config);
    const data = await res.json().catch(() => ({}));

    // Se o usuário não estiver autenticado e tentar acessar o dashboard
    if (res.status === 401 && !window.location.pathname.includes('login.html')) {
      if (isDemoActive) {
        // No modo demo, tenta reconectar silenciosamente ao endpoint demo
        try {
          const demoRes = await fetch(`${API_BASE}/demo-login`, { method: 'POST', credentials: 'include' });
          const demoData = await demoRes.json().catch(() => ({}));
          if (demoData && demoData.token) {
            sessionStorage.setItem('sgh_session_token', demoData.token);
            // Repete a requisição com novo token
            config.headers['Authorization'] = `Bearer ${demoData.token}`;
            const retryRes = await fetch(`${API_BASE}${endpoint}`, config);
            return await retryRes.json();
          }
        } catch {}
      } else {
        sessionStorage.removeItem('sgh_session_token');
        window.location.href = '/login.html';
        return null;
      }
    }

    if (!res.ok) {
      const err = new Error(data.erro || `Erro HTTP ${res.status}: ${res.statusText}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  } catch (err) {
    // Se o usuário estiver no Modo Demonstração e o backend estiver temporariamente indisponível,
    // retorna dados sintéticos realistas para que a apresentação continue perfeita sem travar
    if (isDemoActive) {
      if (endpoint === '/sessao') {
        return {
          autenticado: true,
          usuario: { id: 9999, username: 'Visitante (Demo)', role: 'demo' }
        };
      }
      if (endpoint === '/status') {
        // Gera variação orgânica realista
        let base = 4.5;
        if (localDemoState.scenario === 'repouso') base = 0.0;
        else if (localDemoState.scenario === 'chuveiro') base = 10.5;
        else if (localDemoState.scenario === 'vazamento_leve') base = 0.85;
        else if (localDemoState.scenario === 'ruptura_grave') base = 35.0;

        localDemoState.flow = Number((base + (base > 0 ? (Math.random() * 0.4 - 0.2) : 0)).toFixed(2));
        localDemoState.totalLiters += Number(((localDemoState.flow / 60.0) * 1.5).toFixed(3));
        const totalCost = Number(((localDemoState.totalLiters / 1000) * 4.50).toFixed(2));

        return {
          sucesso: true,
          dados: {
            vazao_lmin: localDemoState.flow,
            litros_totais: Number(localDemoState.totalLiters.toFixed(2)),
            m3_totais: Number((localDemoState.totalLiters / 1000).toFixed(3)),
            consumo_hoje_litros: Number(localDemoState.totalLiters.toFixed(2)),
            consumo_hoje_m3: Number((localDemoState.totalLiters / 1000).toFixed(3)),
            custo_total_estimado: totalCost,
            custo_hoje_estimado: totalCost,
            tarifa_aplicada: '4.50',
            conexao: 'simulacao',
            saude_sensor: localDemoState.flow > 30 ? 'atencao' : 'normal',
            ultima_leitura: new Date().toISOString(),
            status_geral: localDemoState.alerts.filter(a => a.status === 'ativo').length > 0 ? 'Atenção' : 'Normal',
            alertas_ativos: localDemoState.alerts.filter(a => a.status === 'ativo').length,
            dispositivo: {
              nome: 'Simulador Hidráulico Ativo',
              tipo: 'simulado',
              porta: 'VIRTUAL_SIM',
              statusConexao: 'Modo Simulação Ativo'
            }
          }
        };
      }
      if (endpoint.startsWith('/alertas')) {
        return {
          sucesso: true,
          dados: {
            ativos: localDemoState.alerts.filter(a => a.status === 'ativo'),
            historico: localDemoState.alerts.filter(a => a.status !== 'ativo')
          }
        };
      }
      if (endpoint.startsWith('/historico')) {
        return {
          sucesso: true,
          dados: {
            itens: [
              {
                id: 1,
                timestamp: new Date().toISOString(),
                vazao_lmin: localDemoState.flow,
                litros_incrementais: 0.11,
                m3_incrementais: 0.0001,
                litros_acumulados: Number(localDemoState.totalLiters.toFixed(2)),
                m3_acumulados: Number((localDemoState.totalLiters / 1000).toFixed(3)),
                custo_estimado: Number(((localDemoState.totalLiters / 1000) * 4.50).toFixed(2)),
                status: 'normal',
                origem: 'simulado'
              }
            ],
            paginacao: { paginaAtual: 1, totalPaginas: 1, totalRegistros: 1, limitePorPagina: 15 }
          }
        };
      }
      if (endpoint === '/configuracoes') {
        return {
          sucesso: true,
          dados: {
            tarifa_m3: '4.50',
            fator_calibracao: '7.5',
            vazao_maxima_lmin: '30.0',
            tempo_fluxo_continuo_min: '45',
            horario_inativo_inicio: '01:00',
            horario_inativo_fim: '05:00',
            porta_serial: 'VIRTUAL_SIM'
          }
        };
      }
      if (endpoint === '/serial/dispositivos' || endpoint === '/serial/portas') {
        return {
          sucesso: true,
          dados: [],
          portas: [],
          dispositivos: []
        };
      }
    }

    if (!options.silent && err.status !== 401) {
      console.warn(`[API] ${endpoint}:`, err.message);
    }
    throw err;
  }
}

export const SghApi = {
  // Autenticação e Verificação de Sessão
  checkSession: () => request('/sessao', { silent: true }),

  login: async (username, password) => {
    const res = await request('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (res && res.sucesso && res.token) {
      sessionStorage.setItem('sgh_session_token', res.token);
    }
    return res;
  },

  register: async (username, password, confirmPassword) => {
    const res = await request('/registro', {
      method: 'POST',
      body: JSON.stringify({ username, password, confirmPassword })
    });
    if (res && res.sucesso && res.token) {
      sessionStorage.setItem('sgh_session_token', res.token);
    }
    return res;
  },

  getRecoveryCode: () => request('/recuperar-conta/codigo'),

  recoverAccount: async (username, codeOrPin, newPassword, confirmPassword) => {
    const res = await request('/recuperar-conta', {
      method: 'POST',
      body: JSON.stringify({
        username,
        codigo: codeOrPin,
        pin: codeOrPin,
        recoveryKey: codeOrPin,
        newPassword,
        confirmPassword
      })
    });
    if (res && res.sucesso && res.token) {
      sessionStorage.setItem('sgh_session_token', res.token);
    }
    return res;
  },

  logout: async () => {
    sessionStorage.removeItem('sgh_session_token');
    return request('/logout', {
      method: 'POST'
    });
  },

  // Status e Métricas em Tempo Real
  getStatus: () => request('/status'),

  // Histórico com Paginação e Filtros
  getHistory: (page = 1, limit = 15, periodo = 'hoje') =>
    request(`/historico?page=${page}&limit=${limit}&periodo=${periodo}`),

  // Alertas
  getAlerts: () => request('/alertas'),

  acknowledgeAlert: (id, acao = 'resolvido') =>
    request(`/alertas/${id}/reconhecer`, {
      method: 'POST',
      body: JSON.stringify({ acao })
    }),

  clearAllAlerts: (excluir = false) =>
    request('/alertas/limpar-todos', {
      method: 'POST',
      body: JSON.stringify({ excluir })
    }),

  // Configurações
  getConfig: () => request('/configuracoes'),

  updateConfig: (settings) =>
    request('/configuracoes', {
      method: 'PUT',
      body: JSON.stringify(settings)
    }),

  // Portas Seriais e Dispositivos (Arduino & ESP32 - Públicos e Livres)
  getSerialPorts: () => request('/serial/portas'),
  getDevices: () => request('/serial/dispositivos'),
  getSerialStatus: () => request('/serial/status'),

  autoDetectDevice: () =>
    request('/serial/autodetectar', {
      method: 'POST'
    }),

  connectSerial: (porta, baudRate = 115200) =>
    request('/serial/conectar', {
      method: 'POST',
      body: JSON.stringify({ porta, baudRate })
    }),

  disconnectSerial: () =>
    request('/serial/desconectar', {
      method: 'POST'
    }),

  sendTelemetryReading: (payload) =>
    request('/telemetria/leitura', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  // Simulação
  toggleSimulation: () =>
    request('/simulacao/toggle', {
      method: 'POST'
    }),

  setSimulationScenario: (cenario) => {
    if (sessionStorage.getItem('sgh_demo_mode') === 'true') {
      localDemoState.scenario = cenario;
    }
    return request('/simulacao/cenario', {
      method: 'POST',
      body: JSON.stringify({ cenario })
    });
  },

  // Modo Demonstração & Simulação Interativa (Acesso Livre sem Login)
  enterDemoMode: async () => {
    sessionStorage.setItem('sgh_demo_mode', 'true');
    try {
      const res = await request('/demo-login', { method: 'POST', silent: true });
      if (res && res.sucesso && res.token) {
        sessionStorage.setItem('sgh_session_token', res.token);
        return res;
      }
    } catch (err) {
      console.warn('[DEMO] Backend offline ou inicializando; fallback demo ativado localmente:', err.message);
    }

    // Fallback instantâneo 100% offline
    const mockToken = 'demo-session-' + Date.now();
    sessionStorage.setItem('sgh_session_token', mockToken);
    return {
      sucesso: true,
      modoDemo: true,
      mensagem: 'Modo Demonstração ativado localmente com sucesso!',
      usuario: { id: 9999, username: 'Visitante (Demo)', role: 'demo' },
      token: mockToken,
      cenario: 'torneira'
    };
  },

  isDemoMode: () => sessionStorage.getItem('sgh_demo_mode') === 'true',

  exitDemoMode: async () => {
    sessionStorage.removeItem('sgh_demo_mode');
    sessionStorage.removeItem('sgh_session_token');
    try {
      await request('/logout', { method: 'POST', silent: true });
    } catch {}
  },

  triggerTestAlert: (tipo = 'vazamento') => {
    if (sessionStorage.getItem('sgh_demo_mode') === 'true') {
      const newAlert = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        tipo: tipo === 'ruptura' ? 'RUPTURA_CRITICA' : 'VAZAMENTO_CONTINUO',
        severidade: tipo === 'ruptura' ? 'critica' : 'media',
        descricao: tipo === 'ruptura'
          ? 'Demonstração: Ruptura ou vazão anômala severa (>35 L/min)'
          : 'Demonstração: Vazamento contínuo persistente detectado pelo algoritmo',
        status: 'ativo',
        valor_detectado: tipo === 'ruptura' ? '38.5 L/min' : '2.4 L/min'
      };
      localDemoState.alerts.unshift(newAlert);
    }
    return request('/simulacao/alerta-teste', {
      method: 'POST',
      body: JSON.stringify({ tipo })
    });
  },

  injectFlowPulse: (volumeLitros = 5.0) =>
    request('/simulacao/pulso', {
      method: 'POST',
      body: JSON.stringify({ volumeLitros })
    }),

  resetSimulationData: () => {
    if (sessionStorage.getItem('sgh_demo_mode') === 'true') {
      localDemoState.alerts = [];
      localDemoState.totalLiters = 0;
      localDemoState.flow = 0;
    }
    return request('/simulacao/resetar-dados', {
      method: 'POST'
    });
  },

  // Backup
  createBackup: () =>
    request('/backup', {
      method: 'POST'
    }),

  // Diagnóstico
  getHealth: () => request('/saude')
};

