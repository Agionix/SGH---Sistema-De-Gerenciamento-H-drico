/**
 * ==============================================================================
 * SGH — Sistema de Gerenciamento Hidráulico
 * Cliente de API HTTP (Fetch Puro, Comunicação com Hardware Real e Banco de Dados)
 * ==============================================================================
 */

const API_BASE = '/api';

export async function request(endpoint, options = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Garante autenticação segura mesmo dentro de iframes ou navegadores com cookies 3P restritos
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

    // Se a sessão expirou ou não for autenticado e tentar acessar o dashboard
    if (res.status === 401 && !window.location.pathname.includes('login.html')) {
      sessionStorage.removeItem('sgh_session_token');
      window.location.href = '/login.html';
      return null;
    }

    if (!res.ok) {
      const err = new Error(data.erro || `Erro HTTP ${res.status}: ${res.statusText}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  } catch (err) {
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

  // Status e Métricas em Tempo Real (Hardware Real)
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

  // Portas Seriais e Dispositivos (Arduino & ESP32)
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

  // Backup
  createBackup: () =>
    request('/backup', {
      method: 'POST'
    }),

  // Diagnóstico
  getHealth: () => request('/saude')
};
