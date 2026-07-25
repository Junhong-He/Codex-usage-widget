const { app, BrowserWindow, ipcMain, screen, session, net } = require('electron');
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
    proxy_url: '',
  };
}

function logToFile(...args) {
  try {
    const line = args.map((a) => {
      if (a instanceof Error) return a.stack || a.message || String(a);
      if (typeof a === 'object') return JSON.stringify(a);
      return String(a);
    }).join(' ');
    const logPath = path.join(CONFIG_DIR, 'app.log');
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`);
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

// Configure the network proxy for Electron's network stack (net.fetch honors this).
function applyProxy(config) {
  try {
    const url = (config.proxy_url || '').trim();
    if (url) {
      session.defaultSession
        .setProxy({ proxyRules: url })
        .catch((e) => logToFile('setProxy(manual) failed:', e));
    } else {
      // Falls back to the system proxy (Windows: IE / system proxy settings).
      session.defaultSession
        .setProxy({ mode: 'system' })
        .catch((e) => logToFile('setProxy(system) failed:', e));
    }
  } catch (err) {
    logToFile('applyProxy error:', err);
  }
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
  // The OpenAI subscription/hard-limit endpoint (/dashboard/billing/subscription)
  // only accepts a browser session key, NOT an API secret key, so it cannot be
  // fetched here. We fall back to the user-configured monthly quota instead.
  return { monthly_quota: config.monthly_quota || 150_000_000, quota_source: 'manual' };
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatDate(d);
}

async function fetchUsageForDate(baseUrl, apiKey, date) {
  const usageUrl = `${baseUrl}/v1/usage?date=${date}`;
  const response = await net.fetch(usageUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logToFile(`Usage fetch failed for ${date}:`, response.status, text);
    return 0;
  }

  const data = await response.json();
  // Some endpoints return a single object { date, usage }, others wrap it as { data: [...] }.
  if (data && typeof data.usage === 'number') {
    return Number(data.usage);
  }
  if (Array.isArray(data.data)) {
    return data.data.reduce((sum, item) => sum + Number(item.usage || 0), 0);
  }
  return 0;
}

async function fetchOpenAIUsage(config) {
  const baseUrl = (config.base_url || 'https://api.openai.com').replace(/\/$/, '');
  const today = formatDate(new Date());
  const { monthly_quota: monthlyQuota, quota_source: quotaSource } = await fetchMonthlyQuota(config);

  // Query each day individually. Many /v1/usage-compatible endpoints (including
  // some third-party proxies) only accept a single "date" parameter, not a range.
  const dates = [];
  for (let i = 13; i >= 0; i--) {
    dates.push(dateDaysAgo(i));
  }

  const dayMap = {};
  const results = await Promise.all(
    dates.map((date) =>
      fetchUsageForDate(baseUrl, config.api_key, date).then((cents) => ({ date, cents }))
    )
  );
  results.forEach(({ date, cents }) => {
    dayMap[date] = cents;
  });

  // Convert USD cents -> tokens via the configured price per 1M tokens.
  const pricePerToken = (config.price_per_1m_tokens || 5.0) / 1_000_000;
  const centsToday = dayMap[today] || 0;
  const tokensToday = Math.round((centsToday / 100) / pricePerToken);

  let centsWeek = 0;
  for (let i = 0; i < 7; i++) {
    centsWeek += dayMap[dateDaysAgo(i)] || 0;
  }
  const tokensWeek = Math.round((centsWeek / 100) / pricePerToken);

  const recentDays = [];
  for (let i = 13; i >= 0; i--) {
    recentDays.push(Math.round((dayMap[dateDaysAgo(i)] || 0) / 100 / pricePerToken));
  }

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
  const config = readConfig();
  applyProxy(config);

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

  mainWindow.setMinimumSize(300, 180);
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

ipcMain.handle('get-usage', async () => {
  try {
    return await getUsage();
  } catch (err) {
    logToFile('get-usage error:', err);
    throw err;
  }
});
ipcMain.handle('get-config', readConfig);
ipcMain.handle('set-config', (_event, config) => {
  writeConfig(config);
  applyProxy(config);
});
ipcMain.handle('config-dir', () => CONFIG_DIR);
ipcMain.handle('move-window', (_event, dx, dy) => {
  if (mainWindow) {
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + dx, y + dy);
  }
});

ipcMain.handle('resize-window', (_event, width, height) => {
  if (mainWindow) {
    mainWindow.setSize(width, height);
  }
});

ipcMain.handle('resize-window-delta', (_event, anchor, dw, dh) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  const [w, h] = mainWindow.getSize();
  const minW = 300;
  const minH = 180;
  let newW, newH, newX = x, newY = y;
  if (anchor === 'tl') {
    newW = Math.max(minW, w - dw);
    newH = Math.max(minH, h - dh);
    newX = x + (w - newW);
    newY = y + (h - newH);
  } else {
    newW = Math.max(minW, w + dw);
    newH = Math.max(minH, h + dh);
  }
  mainWindow.setBounds({ x: newX, y: newY, width: newW, height: newH });
});

ipcMain.handle('get-window-size', () => {
  if (mainWindow) return mainWindow.getSize();
  return [380, 230];
});
