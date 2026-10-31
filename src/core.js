// 账号切换核心逻辑（不依赖 Electron，可单独测试）
//
// Claude 桌面版的登录状态保存在它数据目录下的几个浏览器存储目录和 config.json 的
// oauth 字段里。切换时关闭 Claude → 把当前账号的这些数据存成快照 → 放回目标账号的
// 快照 → 重启 Claude。其余设置、会话记录、vm_bundles 等两个账号共用，不复制。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// Windows 的 Cookies 在 Network/ 下；macOS 的 Cookies 直接放在数据目录根下
const AUTH_DIRS = ['Network', 'Cookies', 'Cookies-journal', 'Local Storage', 'Session Storage', 'IndexedDB', 'WebStorage'];
const AUTH_KEYS = ['oauth:tokenCache', 'oauth:tokenCacheV2', 'lastKnownAccountUuid'];

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function defaultPaths() {
  const home = os.homedir();
  if (isWin) {
    return {
      dataDir: path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude'),
      profileRoot: path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ClaudeDesktopProfiles'),
    };
  }
  if (isMac) {
    const support = path.join(home, 'Library', 'Application Support');
    return { dataDir: path.join(support, 'Claude'), profileRoot: path.join(support, 'ClaudeDesktopProfiles') };
  }
  const config = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return { dataDir: path.join(config, 'Claude'), profileRoot: path.join(config, 'ClaudeDesktopProfiles') };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8' }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

class Switcher {
  constructor(opts = {}) {
    const d = defaultPaths();
    this.dataDir = opts.dataDir || process.env.CLAUDE_SWITCHER_DATA_DIR || d.dataDir;
    this.profileRoot = opts.profileRoot || process.env.CLAUDE_SWITCHER_PROFILE_ROOT || d.profileRoot;
    // 测试用：不关闭也不启动 Claude
    this.noProcess = opts.noProcess ?? process.env.CLAUDE_SWITCHER_NO_PROCESS === '1';
    this.configPath = path.join(this.dataDir, 'config.json');
    this.activeFile = path.join(this.profileRoot, 'active.txt');
    fs.mkdirSync(this.profileRoot, { recursive: true });
  }

  // ---------- 账号档案 ----------

  safeName(name) {
    const n = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
    if (!n) throw new Error('账号名不能为空');
    if (n.length > 40) throw new Error('账号名太长了');
    return n;
  }

  profileDir(name) { return path.join(this.profileRoot, name); }

  listProfiles() {
    return fs.readdirSync(this.profileRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.endsWith('.saving'))
      .map((e) => {
        let savedAt = null;
        try { savedAt = JSON.parse(fs.readFileSync(path.join(this.profileDir(e.name), 'profile.json'), 'utf8').replace(/^﻿/, '')).savedAt; } catch {}
        return { name: e.name, savedAt };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  getActive() {
    try {
      const a = fs.readFileSync(this.activeFile, 'utf8').replace(/^﻿/, '').trim();
      if (a && fs.existsSync(this.profileDir(a))) return a;
    } catch {}
    return null;
  }

  setActive(name) { fs.writeFileSync(this.activeFile, name, 'utf8'); }

  // ---------- Claude 进程 ----------

  async listClaudePids() {
    if (isWin) {
      const out = await run('wmic', ['process', 'where', "name='claude.exe'", 'get', 'ProcessId,ExecutablePath', '/format:csv']);
      const codeDir = path.join(this.dataDir, 'claude-code').toLowerCase();
      return out.split(/\r?\n/).map((l) => l.trim().split(',')).filter((c) => c.length >= 3).map(([, exe, pid]) => ({ exe: exe.toLowerCase(), pid: Number(pid) }))
        .filter((p) => p.pid && (p.exe.includes('\\windowsapps\\claude_') || p.exe.includes('\\anthropicclaude\\') || p.exe.startsWith(codeDir)))
        .map((p) => p.pid);
    }
    if (isMac) {
      const out = await run('pgrep', ['-x', 'Claude']);
      return out.split('\n').map(Number).filter(Boolean);
    }
    const out = await run('pgrep', ['-x', 'claude-desktop']);
    return out.split('\n').map(Number).filter(Boolean);
  }

  async isClaudeRunning() { return this.noProcess ? false : (await this.listClaudePids()).length > 0; }

  async stopClaude() {
    if (this.noProcess || !(await this.isClaudeRunning())) return;
    // 先礼貌地请求退出，给它保存数据的机会
    if (isMac) await run('osascript', ['-e', 'tell application "Claude" to quit']);
    else if (isWin) for (const pid of await this.listClaudePids()) await run('taskkill', ['/PID', String(pid)]);
    for (let i = 0; i < 16 && (await this.isClaudeRunning()); i++) await sleep(500);
    for (const pid of await this.listClaudePids()) {
      if (isWin) await run('taskkill', ['/F', '/T', '/PID', String(pid)]);
      else try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    for (let i = 0; i < 20 && (await this.isClaudeRunning()); i++) await sleep(500);
    if (await this.isClaudeRunning()) throw new Error('无法关闭 Claude，请手动退出（包括托盘图标）后重试');
    await sleep(1000); // 等文件句柄释放
  }

  async startClaude() {
    if (this.noProcess) return;
    if (isMac) { await run('open', ['-a', 'Claude']); return; }
    if (isWin) {
      const reg = await run('reg', ['query', 'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages']);
      const m = reg.match(/\\(Claude)_[^_\\\r\n]+_[^_\\\r\n]+__([a-z0-9]+)/i);
      if (m) { execFile('explorer.exe', [`shell:AppsFolder\\${m[1]}_${m[2]}!Claude`]); return; }
      const legacy = path.join(process.env.LOCALAPPDATA || '', 'AnthropicClaude', 'claude.exe');
      if (fs.existsSync(legacy)) { execFile(legacy, [], { detached: true, stdio: 'ignore' }).unref(); return; }
      throw new Error('找不到 Claude 桌面版，请手动启动');
    }
    execFile('claude-desktop', [], { detached: true, stdio: 'ignore' }).unref();
  }

  // ---------- 登录数据 ----------

  readConfig() {
    try { return JSON.parse(fs.readFileSync(this.configPath, 'utf8').replace(/^﻿/, '')); } catch { return {}; }
  }

  writeConfig(cfg) {
    if (fs.existsSync(this.configPath)) fs.copyFileSync(this.configPath, this.configPath + '.switcher-bak');
    fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), 'utf8');
  }

  async copyDir(src, dst) {
    // 文件偶尔仍被短暂占用，重试几次
    for (let i = 0; ; i++) {
      try {
        fs.rmSync(dst, { recursive: true, force: true });
        if (fs.statSync(src).isFile()) fs.copyFileSync(src, dst);
        else copyRecursive(src, dst);
        return;
      } catch (e) {
        if (i >= 5) throw new Error(`复制失败：${src}（${e.code || e.message}）`);
        await sleep(800);
      }
    }
  }

  async saveSnapshot(name) {
    const dest = this.profileDir(name);
    const tmp = dest + '.saving';
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const d of AUTH_DIRS) {
      const src = path.join(this.dataDir, d);
      if (fs.existsSync(src)) await this.copyDir(src, path.join(tmp, d));
    }
    const cfg = this.readConfig();
    const auth = {};
    for (const k of AUTH_KEYS) if (k in cfg) auth[k] = cfg[k];
    fs.writeFileSync(path.join(tmp, 'auth.json'), JSON.stringify(auth, null, 2), 'utf8');
    fs.writeFileSync(path.join(tmp, 'profile.json'), JSON.stringify({ savedAt: timestamp() }), 'utf8');
    // 新快照完整写好后再替换旧快照
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
  }

  async restoreSnapshot(name) {
    const src = this.profileDir(name);
    for (const d of AUTH_DIRS) {
      const s = path.join(src, d);
      const t = path.join(this.dataDir, d);
      if (fs.existsSync(s)) await this.copyDir(s, t);
      else fs.rmSync(t, { recursive: true, force: true });
    }
    const cfg = this.readConfig();
    for (const k of AUTH_KEYS) delete cfg[k];
    try { Object.assign(cfg, JSON.parse(fs.readFileSync(path.join(src, 'auth.json'), 'utf8').replace(/^﻿/, ''))); } catch {}
    this.writeConfig(cfg);
  }

  clearLogin() {
    for (const d of AUTH_DIRS) fs.rmSync(path.join(this.dataDir, d), { recursive: true, force: true });
    const cfg = this.readConfig();
    for (const k of AUTH_KEYS) delete cfg[k];
    this.writeConfig(cfg);
  }

  // ---------- 对外操作 ----------

  async getState() {
    return {
      platform: process.platform,
      dataDirExists: fs.existsSync(this.dataDir),
      active: this.getActive(),
      profiles: this.listProfiles(),
      claudeRunning: await this.isClaudeRunning(),
    };
  }

  // 只登记名字；快照在下次切走时保存（此时 Claude 可能在运行，文件被占用）
  register(name) {
    const n = this.safeName(name);
    if (fs.existsSync(this.profileDir(n))) throw new Error(`账号「${n}」已存在`);
    fs.mkdirSync(this.profileDir(n));
    this.setActive(n);
  }

  async switchTo(name, progress = () => {}) {
    const n = this.safeName(name);
    if (!fs.existsSync(this.profileDir(n))) throw new Error(`没有名为「${n}」的账号`);
    const active = this.getActive();
    if (active === n) { if (!(await this.isClaudeRunning())) await this.startClaude(); return; }
    progress('stop'); await this.stopClaude();
    if (active) { progress('save'); await this.saveSnapshot(active); }
    progress('restore'); await this.restoreSnapshot(n);
    this.setActive(n);
    progress('start'); await this.startClaude();
  }

  async addNew(name, progress = () => {}) {
    const n = this.safeName(name);
    if (fs.existsSync(this.profileDir(n))) throw new Error(`账号「${n}」已存在`);
    progress('stop'); await this.stopClaude();
    const active = this.getActive();
    if (active) { progress('save'); await this.saveSnapshot(active); }
    progress('restore'); this.clearLogin();
    fs.mkdirSync(this.profileDir(n));
    this.setActive(n);
    progress('start'); await this.startClaude();
  }

  rename(oldName, newName) {
    const n = this.safeName(newName);
    if (n === oldName) return;
    if (fs.existsSync(this.profileDir(n))) throw new Error(`账号「${n}」已存在`);
    const wasActive = this.getActive() === oldName;
    fs.renameSync(this.profileDir(oldName), this.profileDir(n));
    if (wasActive) this.setActive(n);
  }

  remove(name) {
    if (this.getActive() === name) throw new Error('不能删除当前正在使用的账号');
    fs.rmSync(this.profileDir(name), { recursive: true, force: true });
  }
}

// 不用 fs.cpSync：Node 22 在 Windows 上遇到中文路径会直接崩溃
function copyRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyRecursive(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

function timestamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

module.exports = { Switcher, AUTH_DIRS, AUTH_KEYS };
