import { SghApi } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Elementos do formulário
  const authForm = document.getElementById('authForm');
  const authTitle = document.getElementById('authTitle');
  const authSubtitle = document.getElementById('authSubtitle');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const passwordLabel = document.getElementById('passwordLabel');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  const confirmPasswordLabel = document.getElementById('confirmPasswordLabel');
  const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
  
  // Controles de Recuperação
  const recoveryGroup = document.getElementById('recoveryGroup');
  const displayRecoveryCode = document.getElementById('displayRecoveryCode');
  const btnRefreshRecoveryCode = document.getElementById('btnRefreshRecoveryCode');
  const btnUseRecoveryCode = document.getElementById('btnUseRecoveryCode');
  const recoveryCodeInput = document.getElementById('recoveryCodeInput');

  // Alternadores e Helpers
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const eyeIcon = document.getElementById('eyeIcon');
  const loginOptionsRow = document.getElementById('loginOptionsRow');
  const chkRememberMe = document.getElementById('chkRememberMe');
  const btnForgotPass = document.getElementById('btnForgotPass');
  const alertBox = document.getElementById('alertBox');
  const submitBtn = document.getElementById('submitBtn');
  const btnText = document.getElementById('btnText');
  const btnSpinner = document.getElementById('btnSpinner');

  const btnSwitchMode = document.getElementById('btnSwitchMode');
  const switchPromptText = document.getElementById('switchPromptText');

  let currentMode = 'login'; // 'login', 'register' ou 'recover'
  let latestFetchedRecoveryCode = '';

  // Lembrar usuário salvo
  const savedUsername = localStorage.getItem('sgh_remembered_username');
  if (savedUsername && usernameInput) {
    usernameInput.value = savedUsername;
    if (chkRememberMe) chkRememberMe.checked = true;
  }

  // Controles do Modo Demonstração & Simulação
  const btnEnterDemo = document.getElementById('btnEnterDemo');
  const btnDemoText = document.getElementById('btnDemoText');
  const btnDemoSpinner = document.getElementById('btnDemoSpinner');

  async function handleDemoAccess() {
    if (btnEnterDemo) btnEnterDemo.disabled = true;
    if (btnDemoText) btnDemoText.textContent = 'Iniciando Simulação...';
    if (btnDemoSpinner) btnDemoSpinner.style.display = 'inline-block';
    showAlert('Acessando Modo Demonstração com dados em tempo real...', 'info');

    try {
      await SghApi.enterDemoMode();
      setTimeout(() => {
        window.location.href = '/dashboard.html?demo=true';
      }, 400);
    } catch {
      // Fallback 100% resiliente em qualquer condição
      sessionStorage.setItem('sgh_demo_mode', 'true');
      window.location.href = '/dashboard.html?demo=true';
    }
  }

  btnEnterDemo?.addEventListener('click', handleDemoAccess);

  // Se a URL contiver parâmetro ?demo=true ou hash #demo, ativa o modo demo imediatamente
  if (window.location.search.includes('demo=true') || window.location.hash.includes('demo')) {
    handleDemoAccess();
    return;
  }

  // Se o usuário clicou para sair da simulação (?exit_demo=true), limpa a flag
  if (window.location.search.includes('exit_demo=true')) {
    sessionStorage.removeItem('sgh_demo_mode');
    sessionStorage.removeItem('sgh_session_token');
  }

  // Verifica se já existe uma sessão ativa válida de forma silenciosa (apenas se não solicitou saída)
  if (!window.location.search.includes('exit_demo=true')) {
    try {
      const session = await SghApi.checkSession();
      if (session && session.autenticado) {
        window.location.replace('/dashboard.html');
        return;
      }
    } catch {
      // Permanece no formulário normalmente
    }
  }

  // Busca e exibe o código de recuperação instantâneo do servidor
  async function fetchNewRecoveryCode() {
    if (!displayRecoveryCode) return;
    displayRecoveryCode.textContent = '...';
    try {
      const res = await SghApi.getRecoveryCode();
      if (res && res.sucesso && res.codigo) {
        latestFetchedRecoveryCode = res.codigo;
        displayRecoveryCode.textContent = res.codigo;
      } else {
        latestFetchedRecoveryCode = '1234';
        displayRecoveryCode.textContent = '1234';
      }
    } catch {
      latestFetchedRecoveryCode = '1234';
      displayRecoveryCode.textContent = '1234';
    }
  }

  // Alternar entre modo de Login, Criação de Conta e Recuperação
  function setMode(mode) {
    currentMode = mode;
    clearAlert();

    if (mode === 'recover') {
      authTitle.textContent = 'Recuperar Senha';
      authSubtitle.textContent = 'Redefinição simplificada usando código ou PIN 1234';

      recoveryGroup.style.display = 'block';
      if (recoveryCodeInput) recoveryCodeInput.setAttribute('required', 'true');

      passwordLabel.textContent = 'Nova Senha';
      passwordInput.placeholder = 'Mínimo 4 caracteres';

      confirmPasswordGroup.style.display = 'block';
      confirmPasswordLabel.textContent = 'Confirmar Nova Senha';
      confirmPasswordInput.setAttribute('required', 'true');
      confirmPasswordInput.placeholder = 'Repita a nova senha';

      if (loginOptionsRow) loginOptionsRow.style.display = 'none';

      btnText.textContent = 'Redefinir Senha e Entrar';
      switchPromptText.textContent = 'Lembrou sua senha?';
      btnSwitchMode.textContent = 'Voltar ao Login';
      usernameInput.placeholder = 'Nome do usuário (ex: admin)';

      fetchNewRecoveryCode();

    } else if (mode === 'register') {
      authTitle.textContent = 'Criar Conta';
      authSubtitle.textContent = 'Cadastre um novo operador no SGH';

      recoveryGroup.style.display = 'none';
      if (recoveryCodeInput) recoveryCodeInput.removeAttribute('required');

      passwordLabel.textContent = 'Senha de Acesso';
      passwordInput.placeholder = 'Mínimo 4 caracteres';

      confirmPasswordGroup.style.display = 'block';
      confirmPasswordLabel.textContent = 'Confirmar Senha';
      confirmPasswordInput.setAttribute('required', 'true');
      confirmPasswordInput.placeholder = 'Repita sua senha';

      if (loginOptionsRow) loginOptionsRow.style.display = 'none';

      btnText.textContent = 'Cadastrar e Acessar';
      switchPromptText.textContent = 'Já possui uma conta?';
      btnSwitchMode.textContent = 'Voltar ao Login';
      usernameInput.placeholder = 'Ex: operador_02';

    } else {
      // Modo: login
      authTitle.textContent = 'Login';
      authSubtitle.textContent = 'Sistema de Gerenciamento Hidráulico';

      recoveryGroup.style.display = 'none';
      if (recoveryCodeInput) recoveryCodeInput.removeAttribute('required');

      passwordLabel.textContent = 'Senha de Acesso';
      passwordInput.placeholder = '••••••••';

      confirmPasswordGroup.style.display = 'none';
      confirmPasswordInput.removeAttribute('required');

      if (loginOptionsRow) loginOptionsRow.style.display = 'flex';

      btnText.textContent = 'Entrar';
      switchPromptText.textContent = 'Não tem uma conta?';
      btnSwitchMode.textContent = 'Criar conta';
      usernameInput.placeholder = 'Ex: admin';
    }
  }

  btnForgotPass?.addEventListener('click', () => setMode('recover'));

  btnSwitchMode?.addEventListener('click', () => {
    if (currentMode === 'login') {
      setMode('register');
    } else {
      setMode('login');
    }
  });

  // Ação de Usar Código Imediato
  btnUseRecoveryCode?.addEventListener('click', () => {
    if (recoveryCodeInput && latestFetchedRecoveryCode) {
      recoveryCodeInput.value = latestFetchedRecoveryCode;
      showAlert(`Código [${latestFetchedRecoveryCode}] preenchido automaticamente!`, 'success');
      if (passwordInput) passwordInput.focus();
    }
  });

  // Ação de Gerar Novo Código
  btnRefreshRecoveryCode?.addEventListener('click', () => {
    fetchNewRecoveryCode();
    showAlert('Novo código gerado com sucesso.', 'info');
  });

  // Alternar visualização da senha
  togglePasswordBtn?.addEventListener('click', () => {
    const isPassword = passwordInput.getAttribute('type') === 'password';
    const newType = isPassword ? 'text' : 'password';
    passwordInput.setAttribute('type', newType);
    if (confirmPasswordInput) {
      confirmPasswordInput.setAttribute('type', newType);
    }
    
    // Atualiza SVG do ícone do olho
    if (eyeIcon) {
      if (isPassword) {
        eyeIcon.innerHTML = `
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        `;
      } else {
        eyeIcon.innerHTML = `
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        `;
      }
    }
    togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Exibir senha');
  });

  // Submissão do formulário
  authForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;
    const codeOrPin = recoveryCodeInput ? recoveryCodeInput.value.trim() : '';

    if (!username) {
      showAlert('Por favor, informe o nome de usuário.', 'danger');
      usernameInput.focus();
      return;
    }

    // Salva ou remove o usuário lembrado
    if (chkRememberMe && chkRememberMe.checked) {
      localStorage.setItem('sgh_remembered_username', username);
    } else {
      localStorage.removeItem('sgh_remembered_username');
    }

    if (currentMode === 'recover') {
      if (!codeOrPin) {
        showAlert('Informe o código de 6 dígitos exibido na tela ou o PIN 1234.', 'danger');
        recoveryCodeInput.focus();
        return;
      }

      if (!password || password.length < 4) {
        showAlert('A nova senha deve conter no mínimo 4 caracteres.', 'danger');
        passwordInput.focus();
        return;
      }

      if (password !== confirmPassword) {
        showAlert('A confirmação de senha não confere com a nova senha digitada.', 'danger');
        confirmPasswordInput.focus();
        return;
      }
    } else if (currentMode === 'register') {
      if (username.length < 3) {
        showAlert('O nome de usuário deve conter pelo menos 3 caracteres.', 'danger');
        usernameInput.focus();
        return;
      }

      if (!password || password.length < 4) {
        showAlert('A senha deve conter no mínimo 4 caracteres.', 'danger');
        passwordInput.focus();
        return;
      }

      if (password !== confirmPassword) {
        showAlert('As senhas digitadas não coincidem. Verifique a confirmação.', 'danger');
        confirmPasswordInput.focus();
        return;
      }
    } else {
      // Modo login
      if (!password) {
        showAlert('Por favor, informe a senha de acesso.', 'danger');
        passwordInput.focus();
        return;
      }
    }

    setLoading(true);

    try {
      if (currentMode === 'recover') {
        const response = await SghApi.recoverAccount(username, codeOrPin, password, confirmPassword);
        if (response && response.sucesso) {
          showAlert('Senha redefinida com sucesso! Acessando o sistema...', 'success');
          setTimeout(() => {
            window.location.href = '/dashboard.html';
          }, 600);
        } else {
          showAlert(response.erro || 'Falha ao recuperar conta.', 'danger');
        }
      } else if (currentMode === 'register') {
        const response = await SghApi.register(username, password, confirmPassword);
        if (response && response.sucesso) {
          showAlert('Conta criada com sucesso! Redirecionando...', 'success');
          setTimeout(() => {
            window.location.href = '/dashboard.html';
          }, 600);
        } else {
          showAlert(response.erro || 'Erro ao criar conta.', 'danger');
        }
      } else {
        const response = await SghApi.login(username, password);
        if (response && response.sucesso) {
          showAlert('Autenticado com sucesso! Redirecionando...', 'success');
          setTimeout(() => {
            window.location.href = '/dashboard.html';
          }, 400);
        } else {
          showAlert(response.erro || 'Credenciais inválidas. Verifique usuário e senha.', 'danger');
        }
      }
    } catch (err) {
      showAlert(err.message || 'Erro ao conectar ao servidor.', 'danger');
    } finally {
      setLoading(false);
    }
  });

  function showAlert(message, type = 'danger') {
    alertBox.textContent = message;
    alertBox.className = `alert-box alert-${type} show`;
  }

  function clearAlert() {
    alertBox.textContent = '';
    alertBox.className = 'alert-box';
  }

  function setLoading(loading) {
    if (loading) {
      submitBtn.disabled = true;
      if (currentMode === 'recover') {
        btnText.textContent = 'Redefinindo senha...';
      } else if (currentMode === 'register') {
        btnText.textContent = 'Criando conta...';
      } else {
        btnText.textContent = 'Entrando...';
      }
      btnSpinner.style.display = 'inline-block';
    } else {
      submitBtn.disabled = false;
      if (currentMode === 'recover') {
        btnText.textContent = 'Redefinir Senha e Entrar';
      } else if (currentMode === 'register') {
        btnText.textContent = 'Cadastrar e Acessar';
      } else {
        btnText.textContent = 'Entrar';
      }
      btnSpinner.style.display = 'none';
    }
  }
});
