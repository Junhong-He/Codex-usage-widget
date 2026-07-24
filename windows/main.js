const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.codex-usage-widget');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function defaultConfig() {
  return {
    api_key: '',
    base_url: 'https://api.openai.com',
    monthly_quota: 150_000_000,
    price_per_1m_tokens: 5.0,
    provider: 'mock',
  };
}

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return defaultConfig();
    }
    return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch (err) {
    console.error('Failed to read config:', err);
    return defaultConfig();
  }
}

function writeConfig(config) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Failed to write config:', err);
    throw err;
  }
}

function deriveLimits(monthlyQuota) {
  return {
    dailyLimit: Math.round(monthlyQuota / 30),
    weeklyLimit: Math.round(monthlyQuota / 4),
  };
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatRemaining(tokens, isDay) {
  if (isDay) {
    const minutes = Math.max(1, tokens / 100);
    const hours = Math.round(minutes / 60);
    if (hours < 1) return `${Math.round(minutes)}m`;
    return `${hours}h`;
  }
  const days = Math.max(1, Math.round(tokens / 2_000_000));
  return `${days}d`;
}

function generateRecentDays(todayValue, count = 14) {
  const days = [];
  for (let i = 0; i < count - 1; i++) {
    days.push(Math.max(0, todayValue * (0.2 + Math.random() * 1.0)));
  }
  days.push(todayValue);
  return days;
}

function buildSnapshot(tokensToday, tokensWeek, recentDays, monthlyQuota, quotaSource) {
  const { dailyLimit, weeklyLimit } = deriveLimits(monthlyQuota);
  const dayPercent = dailyLimit > 0
    ? Math.max(0, Math.min(100, (tokensToday / dailyLimit) * 100))
    : 0;
  const weekPercent = weeklyLimit > 0
    ? Math.max(0, Math.min(100, (tokensWeek / weeklyLimit) * 100))
    : 0;
  const dayRemaining = Math.max(0, dailyLimit - tokensToday);
  const weekRemaining = Math.max(0, weeklyLimit - tokensWeek);

  return {
    updated_at: new Date().toISOString(),
    tokens_today: tokensToday,
    tokens_week: tokensWeek,
    monthly_quota: monthlyQuota,
    daily_limit: dailyLimit,
    weekly_limit: weeklyLimit,
    day_percent: dayPercent,
    week_percent: weekPercent,
    day_remaining_label: formatRemaining(dayRemaining, true),
    week_remaining_label: formatRemaining(weekRemaining, false),
    recent_days: recentDays,
    quota_source: quotaSource,
  };
}

async function fetchMonthlyQuota(config) {
  const baseUrl = (config.base_url || 'https://api.openai.com').replace(/\/$/, '');
  const url = `${baseUrl}/dashboard/billing/subscription`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return { monthly_quota: config.monthly_quota, quota_source: 'manual' };
    }

    const data = await response.json();
    const dollarLimit =
      (typeof data.system_hard_limit_usd === 'number' ? data.system_hard_limit_usd : undefined) ??
      (typeof data.hard_limit_usd === 'number' ? data.hard_limit_usd : undefined) ??
      0;

    if (dollarLimit <= 0) {
      return { monthly_quota: config.monthly_quota, quota_source: 'manual' };
    }

    const pricePerToken = (config.price_per_1m_tokens || 5.0) / 1_000_000;
    const tokens = Math.round(dollarLimit / pricePerToken);
    return { monthly_quota: tokens, quota_source: 'subscription' };
  } catch (err) {
    console.error('Failed to fetch subscription quota:', err);
    return { monthly_quota: config.monthly_quota, quota_source: 'manual' };
  }
}

async function fetchOpenAIUsage(config) {
  const today = new Date().toISOString().split('T')[0];
  const baseUrl = (config.base_url || 'https://api.openai.com').replace(/\/$/, '');
  const usageUrl = `${baseUrl}/v1/usage?date=${today}`;

  const { monthly_quota: monthlyQuota, quota_source: quotaSource } = await fetchMonthlyQuota(config);

  const response = await fetch(usageUrl, {
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const totalCents = data.total_usage ?? 0;
  const tokensToday = Math.round(totalCents / 0.000005 / 100);
  const tokensWeek = Math.round(tokensToday * 2.5);
  const recentDays = generateRecentDays(tokensToday, 14);
  return buildSnapshot(tokensToday, tokensWeek, recentDays, monthlyQuota, quotaSource);
}

function mockSnapshot(config) {
  const { dailyLimit, weeklyLimit } = deriveLimits(config.monthly_quota || 150_000_000);
  const dayUsage = 0.55 + Math.random() * 0.4;
  const weekUsage = 0.25 + Math.random() * 0.55;
  const tokensToday = Math.min(config.monthly_quota || 150_000_000, Math.round(dailyLimit * dayUsage));
  const tokensWeek = Math.min(config.monthly_quota || 150_000_000, Math.round(weeklyLimit * weekUsage));
  const recentDays = generateRecentDays(tokensToday, 14);
  return buildSnapshot(tokensToday, tokensWeek, recentDays, config.monthly_quota || 150_000_000, 'manual');
}

async function getUsage() {
  const config = readConfig();
  if (config.provider === 'mock' || !config.api_key) {
    return mockSnapshot(config);
  }
  return fetchOpenAIUsage(config);
}

let mainWindow;

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 380;
  const winHeight = 230;

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: screenWidth - winWidth - 20,
    y: screenHeight - winHeight - 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Optional: open DevTools during development
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-usage', getUsage);
ipcMain.handle('get-config', readConfig);
ipcMain.handle('set-config', (_event, config) => {
  writeConfig(config);
});
ipcMain.handle('config-dir', () => CONFIG_DIR);
ipcMain.handle('move-window', (_event, dx, dy) => {
  if (mainWindow) {
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + dx, y + dy);
  }
});
