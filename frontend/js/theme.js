/**
 * SGH — Gerenciador de Tema (Modo Claro / Modo Escuro)
 * Persistência automática via localStorage e detecção de preferência do sistema.
 */

const STORAGE_KEY = 'sgh_theme';

export function getPreferredTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') {
    return saved;
  }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme) {
  const targetTheme = theme === 'dark' ? 'dark' : 'light';
  if (targetTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try {
    localStorage.setItem(STORAGE_KEY, targetTheme);
  } catch {
    // LocalStorage indisponível em sandbox
  }
  updateToggleButtons(targetTheme);

  // Notificar outros componentes (ex: Chart.js no dashboard)
  window.dispatchEvent(new CustomEvent('sgh:themechange', { detail: { theme: targetTheme } }));
}

export function toggleTheme() {
  const current = getCurrentTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

function updateToggleButtons(theme) {
  const buttons = document.querySelectorAll('#btnToggleTheme, [data-theme-toggle]');
  buttons.forEach((btn) => {
    const sunIcon = btn.querySelector('.theme-icon-sun');
    const moonIcon = btn.querySelector('.theme-icon-moon');
    const isDark = theme === 'dark';

    if (sunIcon) sunIcon.style.display = isDark ? 'inline-block' : 'none';
    if (moonIcon) moonIcon.style.display = isDark ? 'none' : 'inline-block';

    btn.setAttribute('title', isDark ? 'Alternar para Modo Claro' : 'Alternar para Modo Escuro');
    btn.setAttribute('aria-label', isDark ? 'Alternar para Modo Claro' : 'Alternar para Modo Escuro');
  });
}

export function initTheme() {
  const theme = getPreferredTheme();
  applyTheme(theme);

  // Vincular eventos a todos os botões de toggle
  document.addEventListener('click', (e) => {
    const target = e.target.closest('#btnToggleTheme, [data-theme-toggle]');
    if (target) {
      e.preventDefault();
      toggleTheme();
    }
  });

  // Escutar alterações do sistema operacional se o usuário não escolheu explicitamente
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
}

// Inicialização imediata ao carregar
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
}
