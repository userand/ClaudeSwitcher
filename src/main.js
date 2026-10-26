const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const { Switcher } = require('./core');

let win;
let switcher;
let busy = false;

// 与 styles.css 中的 --bg 保持一致
const bgColor = () => (nativeTheme.shouldUseDarkColors ? '#0d0d0f' : '#f5f3ef');

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 660,
    minWidth: 360,
    minHeight: 540,
    title: 'Switcher for Claude',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    backgroundColor: bgColor(),
    // 隐藏系统标题栏，由页面绘制；Mac 保留红绿灯，Windows 的最小化/关闭按钮由页面自绘
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 15 },
    maximizable: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  nativeTheme.on('updated', () => win.setBackgroundColor(bgColor()));
}

// 同一时间只允许一个修改操作
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    if (busy) return { ok: false, error: '上一个操作还没完成' };
    busy = true;
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.message }; }
    finally { busy = false; }
  });
}

const progress = (step) => win && win.webContents.send('progress', step);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    switcher = new Switcher();
    ipcMain.handle('state', async () => ({ ...(await switcher.getState()), busy }));
    handle('register', (name) => switcher.register(name));
    handle('switch', (name) => switcher.switchTo(name, progress));
    handle('add', (name) => switcher.addNew(name, progress));
    handle('rename', (oldName, newName) => switcher.rename(oldName, newName));
    handle('remove', (name) => switcher.remove(name));
    handle('launch', () => switcher.startClaude());
    ipcMain.on('window', (_e, action) => {
      if (action === 'minimize') win.minimize();
      else if (action === 'close') win.close();
    });
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
