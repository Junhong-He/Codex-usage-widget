// Use Electron's exposed API when running inside the Electron shell.
const api = window.electronAPI;

let currentSnapshot = null;
let refreshTimer = null;
let isRefreshing = false;

const els = {
  widget: document.getElementById('widget'),
  statusDot: document.getElementById('statusDot'),
  updateText: document.getElementById('updateText'),
  tokenCount: document.getElementById('tokenCount'),
  dayFill: document.getElementById('dayFill'),
  dayPercent: document.getElementById('dayPercent'),
  dayRemaining: document.getElementById('dayRemaining'),
  weekFill: document.getElementById('weekFill'),
  weekPercent: document.getElementById('weekPercent'),
  weekRemaining: document.getElementById('weekRemaining'),
  activityDots: document.getElementById('activityDots'),
  refreshBtn: document.getElementById('refreshBtn'),
  settingsPanel: document.getElementById('settingsPanel'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  monthlyQuotaInput: document.getElementById('monthlyQuotaInput'),
  pricePer1mInput: document.getElementById('pricePer1mInput'),
  providerInput: document.getElementById('providerInput'),
  saveSettings: document.getElementById('saveSettings'),
  cancelSettings: document.getElementById('cancelSettings'),
};

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function formatUpdatedAt(isoDate) {
  const date = new Date(isoDate);
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `Updated at ${h}:${m}`;
}

function renderBars(recentDays) {
  if (!recentDays || recentDays.length === 0) return;
  const max = Math.max(...recentDays, 1);
  let html = '';
  recentDays.forEach((value, i) => {
    const isToday = i === recentDays.length - 1;
    const height = Math.max(12, (value / max) * 100);
    html += `<div class="bar ${isToday ? 'today' : ''}" style="height:${height}%"></div>`;
  });
  els.activityDots.innerHTML = html;
}

function render(snapshot) {
  currentSnapshot = snapshot;

  els.tokenCount.textContent = formatTokens(snapshot.tokens_today);
  els.updateText.textContent = formatUpdatedAt(snapshot.updated_at);

  els.dayFill.style.width = `${snapshot.day_percent}%`;
  els.dayPercent.textContent = `${Math.round(snapshot.day_percent)}%`;
  els.dayRemaining.textContent = snapshot.day_remaining_label;

  els.weekFill.style.width = `${snapshot.week_percent}%`;
  els.weekPercent.textContent = `${Math.round(snapshot.week_percent)}%`;
  els.weekRemaining.textContent = snapshot.week_remaining_label;

  renderBars(snapshot.recent_days);
}

async function refresh() {
  if (isRefreshing) return;
  isRefreshing = true;
  els.refreshBtn.classList.add('spinning');

  try {
    if (api) {
      const snapshot = await api.getUsage();
      render(snapshot);
      els.statusDot.classList.remove('stale');
    } else {
      // Demo mode when opened in a browser without Electron
      const monthlyQuota = 150_000_000;
      const dailyLimit = Math.round(monthlyQuota / 30);
      const weeklyLimit = Math.round(monthlyQuota / 4);
      const dayUsage = 0.5 + Math.random() * 0.5;
      const weekUsage = 0.2 + Math.random() * 0.6;
      const tokensToday = Math.round(dailyLimit * dayUsage);
      const tokensWeek = Math.round(weeklyLimit * weekUsage);
      const recentDays = [];
      for (let i = 0; i < 13; i++) {
        recentDays.push(tokensToday * (0.2 + Math.random() * 1.0));
      }
      recentDays.push(tokensToday);
      render({
        updated_at: new Date().toISOString(),
        tokens_today: tokensToday,
        tokens_week: tokensWeek,
        monthly_quota: monthlyQuota,
        daily_limit: dailyLimit,
        weekly_limit: weeklyLimit,
        day_percent: dayUsage * 100,
        week_percent: weekUsage * 100,
        day_remaining_label: `${Math.max(1, Math.round((dailyLimit - tokensToday) / 500_000))}h`,
        week_remaining_label: `${Math.max(1, Math.round((weeklyLimit - tokensWeek) / 2_000_000))}d`,
        recent_days: recentDays,
        quota_source: 'manual',
      });
    }
  } catch (err) {
    console.error('Failed to fetch usage:', err);
    els.updateText.textContent = 'Update failed';
    els.statusDot.classList.add('stale');
  } finally {
    isRefreshing = false;
    els.refreshBtn.classList.remove('spinning');
  }
}

const NORMAL_WIDTH = 380;
const NORMAL_HEIGHT = 230;
const SETTINGS_WIDTH = 380;
const SETTINGS_HEIGHT = 380;
let preSettingsSize = [NORMAL_WIDTH, NORMAL_HEIGHT];

async function openSettings() {
  if (!api) return;
  if (api.getWindowSize) preSettingsSize = await api.getWindowSize();
  const config = await api.getConfig();
  els.apiKeyInput.value = config.api_key || '';
  els.providerInput.value = config.provider || 'mock';
  els.pricePer1mInput.value = config.price_per_1m_tokens ?? 5.0;
  els.monthlyQuotaInput.value = config.monthly_quota || 150000000;
  api.resizeWindow(SETTINGS_WIDTH, SETTINGS_HEIGHT);
  els.settingsPanel.classList.add('open');
}

function closeSettings() {
  els.settingsPanel.classList.remove('open');
  if (api && api.resizeWindow) {
    api.resizeWindow(preSettingsSize[0], preSettingsSize[1]);
  }
}

async function saveSettings() {
  if (!api) return;
  const config = {
    api_key: els.apiKeyInput.value.trim(),
    provider: els.providerInput.value,
    price_per_1m_tokens: Number(els.pricePer1mInput.value),
    monthly_quota: Number(els.monthlyQuotaInput.value),
  };
  await api.setConfig(config);
  closeSettings();
  await refresh();
}

// Drag support for the frameless window
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// Resize support via the top-left and bottom-right corner handles
let isResizing = false;
let resizeLast = { x: 0, y: 0 };
let resizeAnchor = 'br';
const resizeHandles = els.widget.querySelectorAll('.resize-handle');

resizeHandles.forEach((handle) => {
  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeAnchor = handle.id === 'resizeHandleTL' ? 'tl' : 'br';
    resizeLast.x = e.clientX;
    resizeLast.y = e.clientY;
    e.preventDefault();
    e.stopPropagation();
  });
});

els.widget.addEventListener('mousedown', (e) => {
  if (e.target.closest('.icon-btn') || e.target.closest('.settings-panel') || e.target.closest('.resize-handle')) return;
  isDragging = true;
  dragOffset.x = e.clientX;
  dragOffset.y = e.clientY;
});

document.addEventListener('mousemove', (e) => {
  if (isResizing) {
    const dx = e.clientX - resizeLast.x;
    const dy = e.clientY - resizeLast.y;
    resizeLast.x = e.clientX;
    resizeLast.y = e.clientY;
    if (api && api.resizeWindowDelta) api.resizeWindowDelta(resizeAnchor, dx, dy);
    return;
  }
  if (!isDragging) return;
  const dx = e.clientX - dragOffset.x;
  const dy = e.clientY - dragOffset.y;
  dragOffset.x = e.clientX;
  dragOffset.y = e.clientY;
  if (api && api.moveWindow) {
    api.moveWindow(dx, dy);
  }
});

document.addEventListener('mouseup', () => {
  isDragging = false;
  isResizing = false;
});

// Event listeners
els.refreshBtn.addEventListener('click', refresh);
els.refreshBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openSettings();
});
els.saveSettings.addEventListener('click', saveSettings);
els.cancelSettings.addEventListener('click', closeSettings);

// Refresh every 60 seconds
refresh();
refreshTimer = setInterval(refresh, 60000);

// Right-click on the body opens settings
document.body.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.widget-actions') || e.target.closest('.settings-panel')) return;
  e.preventDefault();
  openSettings();
});
