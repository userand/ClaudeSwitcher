// window.api 由 preload 通过 contextBridge 注入，是全局变量，这里不能再声明同名变量
const $ = (id) => document.getElementById(id);

const isMac = navigator.userAgent.includes('Mac');
const GRADIENTS = [
  ['#ffa077', '#e2522f'], ['#7aa7ff', '#3d63d9'], ['#5fd3a0', '#1f9a6a'], ['#c49bff', '#7a4fd6'],
  ['#ffcf6b', '#e0901c'], ['#5ed0d6', '#1e8f9b'], ['#ff8fb3', '#d24a7a'], ['#a3b1c6', '#5c6b82'],
];
const STEPS = { stop: '正在关闭 Claude', save: '正在保存当前账号', restore: '正在载入目标账号', start: '正在启动 Claude' };
const ICONS = {
  more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
  arrow: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/></svg>',
  check: '<svg viewBox="0 0 16 16"><path d="M4 8.5l2.5 2.5L12 5.5"/></svg>',
  alert: '<svg viewBox="0 0 16 16"><path d="M8 4.5v4M8 11.5v.01"/></svg>',
};

let state = null;
let openMenu = null;
let firstRender = true;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function gradientOf(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const [a, b] = GRADIENTS[h % GRADIENTS.length];
  return `linear-gradient(140deg, ${a}, ${b})`;
}

function avatar(name, size) {
  return `<div class="avatar ${size}" style="background:${gradientOf(name)}">${esc([...name][0] || '?')}</div>`;
}

function relTime(s) {
  if (!s) return null;
  const diff = (Date.now() - new Date(s.replace(' ', 'T'))) / 1000;
  if (isNaN(diff)) return s;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return s.slice(0, 10);
}

// ---------- 渲染 ----------

async function refresh() {
  const next = await api.state();
  if (state && JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  closeMenu();
  render();
}

function others() { return state.profiles.filter((p) => p.name !== state.active); }

function render() {
  const { active, profiles, claudeRunning } = state;
  const list = others();
  let i = 0;
  const r = () => `reveal" style="--i:${i++}`;
  let html = '';

  const statusChip = claudeRunning
    ? '<span class="chip live"><span class="dot"></span>Claude 运行中</span>'
    : '<button class="chip" data-act="launch"><span class="dot"></span>Claude 未运行 · 启动</button>';

  if (!active) {
    const fresh = !profiles.length;
    html += `
      <section class="onboard ${fresh ? '' : 'warn'} ${r()}">
        <img class="onboard-icon" src="icon.png" alt="">
        <h2>${fresh ? '欢迎使用 Switcher' : '当前登录尚未登记'}</h2>
        <p>${fresh ? 'Claude 里现在登录的是哪个账号？给它起个名字，之后一键切换。' : 'Claude 里现在的登录不属于任何已保存的账号，先登记它，否则切换后会丢失。'}</p>
        <form id="regForm"><input id="regInput" class="field" placeholder="${fresh ? '例如：工作账号' : '给它起个名字'}" maxlength="40"><button class="btn btn-primary">登记</button></form>
      </section>`;
  } else {
    const cur = profiles.find((p) => p.name === active);
    const saved = relTime(cur && cur.savedAt);
    html += `
      <section class="hero">
        <div class="hero-avatar ${r()}">${avatar(active, 'xl')}</div>
        <div class="hero-name ${r()}" title="${esc(active)}">${esc(active)}</div>
        <div class="hero-sub ${r()}">
          ${statusChip}
          <span class="chip">${saved ? `快照 ${saved}` : '切走时自动保存'}</span>
        </div>
      </section>`;
  }

  if (profiles.length) {
    html += `
      <div class="section-head ${r()}">
        <span class="section-title">${active ? '切换到' : '已保存的账号'}<b>${list.length}</b></span>
        ${list.length && active ? `<span class="section-hint">按数字键快速切换</span>` : ''}
      </div>`;
    if (!list.length) {
      html += `<div class="empty ${r()}"><strong>只有一个账号</strong>点击下方「添加账号」登录第二个账号</div>`;
    } else {
      html += '<div class="list">' + list.map((p, idx) => {
        const saved = relTime(p.savedAt);
        return `
          <div class="row ${r()}" data-name="${esc(p.name)}">
            ${avatar(p.name, 'md')}
            <div class="row-info">
              <div class="row-name">${esc(p.name)}</div>
              <div class="row-meta">${saved ? `上次使用 ${saved}` : '尚未登录'}</div>
            </div>
            <div class="row-actions">
              ${idx < 9 && active ? `<kbd class="kbd">${idx + 1}</kbd>` : ''}
              <button class="btn btn-primary btn-sm switch-btn" data-act="switch" ${active ? '' : 'disabled'}>切换 ${ICONS.arrow}</button>
              <button class="icon-btn" data-act="menu" aria-label="更多">${ICONS.more}</button>
            </div>
          </div>`;
      }).join('') + '</div>';
    }
  }

  const main = $('main');
  main.classList.toggle('anim', firstRender);
  main.innerHTML = html;
  firstRender = false;
  // 当前登录未登记时添加新账号会清掉它，必须先登记
  $('addBtn').disabled = !active;

  const regForm = $('regForm');
  if (regForm) {
    $('regInput').focus();
    regForm.onsubmit = async (e) => {
      e.preventDefault();
      const name = $('regInput').value.trim();
      if (!name) return;
      const res = await api.register(name);
      res.ok ? toast(`已登记「${name}」`) : toast(res.error, true);
      refresh();
    };
  }
}

// ---------- 交互 ----------

$('main').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'launch') return launch();
  const name = btn.closest('.row').dataset.name;
  if (act === 'switch') return doSwitch(name);
  if (act === 'menu') return toggleMenu(btn.closest('.row'), name);
});

document.addEventListener('click', (e) => {
  if (openMenu && !e.target.closest('.menu') && !e.target.closest('[data-act="menu"]')) closeMenu();
});

function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }

function toggleMenu(row, name) {
  const had = openMenu && openMenu.parentElement === row;
  closeMenu();
  if (had) return;
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = `<button data-m="rename">${ICONS.edit}重命名</button><button data-m="remove" class="danger">${ICONS.trash}删除</button>`;
  m.onclick = async (e) => {
    const act = e.target.closest('button')?.dataset.m;
    closeMenu();
    if (act === 'rename') {
      const n = await dialog({ title: '重命名账号', input: name, ok: '保存' });
      if (n && n !== name) { const res = await api.rename(name, n); res.ok ? toast('已重命名') : toast(res.error, true); refresh(); }
    } else if (act === 'remove') {
      const yes = await dialog({ title: `删除「${name}」？`, text: '会删除这个账号保存的登录快照，之后要用需要重新登录。', ok: '删除', danger: true });
      if (yes) { const res = await api.remove(name); res.ok ? toast('已删除') : toast(res.error, true); refresh(); }
    }
  };
  row.appendChild(m);
  openMenu = m;
}

async function launch() {
  const res = await api.launch();
  res.ok ? toast('正在启动 Claude…') : toast(res.error, true);
  setTimeout(refresh, 3000);
}

async function addAccount() {
  if ($('addBtn').disabled) return;
  const name = await dialog({ title: '添加账号', text: '给新账号起个名字。\n确定后 Claude 会重启并退出登录，在里面登录新账号即可。', input: '', placeholder: '例如：个人账号', ok: '继续' });
  if (!name) return;
  await runOp(name, `正在添加「${name}」`, () => api.add(name), `请在 Claude 中登录「${name}」`);
}
$('addBtn').onclick = addAccount;

async function doSwitch(name) {
  if (!state.active) return;
  if (state.claudeRunning) {
    const yes = await dialog({ title: `切换到「${name}」？`, text: 'Claude 会关闭并重新打开，正在进行的对话和任务会中断。', ok: '切换' });
    if (!yes) return;
  }
  await runOp(name, `切换到「${name}」`, () => api.switchTo(name), `已切换到「${name}」`);
}

async function runOp(name, title, fn, doneMsg) {
  $('ringAvatar').innerHTML = avatar(name, 'md');
  $('progTitle').textContent = title;
  $('progStep').textContent = '准备中…';
  setRing(0);
  $('overlay').hidden = false;
  const res = await fn();
  setRing(4);
  await new Promise((r) => setTimeout(r, 350));
  $('overlay').hidden = true;
  res.ok ? toast(doneMsg) : toast(res.error, true);
  refresh();
  setTimeout(refresh, 4000); // 等 Claude 启动后更新状态
}

function setRing(done) { $('ringBar').style.strokeDashoffset = String(326.7 * (1 - done / 4)); }

api.onProgress((step) => {
  const keys = Object.keys(STEPS);
  setRing(keys.indexOf(step) + 0.5);
  $('progStep').textContent = STEPS[step] + '…';
});

// 键盘：数字键切换，Ctrl/⌘+N 添加，Esc 关闭弹窗
document.addEventListener('keydown', (e) => {
  if (!$('modal').hidden) { if (e.key === 'Escape') $('modalCancel').click(); return; }
  if (!$('overlay').hidden || !state || e.target.matches('input')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); return addAccount(); }
  if (e.key === 'Escape') return closeMenu();
  const n = Number(e.key);
  if (n >= 1 && n <= 9 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const p = others()[n - 1];
    if (p) doSwitch(p.name);
  }
});

// ---------- 通用弹窗与提示 ----------

function dialog({ title, text = '', input = null, placeholder = '', ok = '确定', danger = false }) {
  return new Promise((resolve) => {
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalText').hidden = !text;
    const inp = $('modalInput');
    inp.hidden = input === null;
    inp.value = input || '';
    inp.placeholder = placeholder;
    const okBtn = $('modalOk');
    okBtn.textContent = ok;
    okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    $('modal').hidden = false;
    setTimeout(() => (input === null ? okBtn : inp).focus(), 30);

    const done = (v) => { $('modal').hidden = true; $('modalForm').onsubmit = null; $('modalCancel').onclick = null; resolve(v); };
    $('modalForm').onsubmit = (e) => {
      e.preventDefault();
      if (input === null) return done(true);
      const v = inp.value.trim();
      if (v) done(v);
    };
    $('modalCancel').onclick = () => done(null);
  });
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('toast');
  t.className = 'toast' + (error ? ' error' : '');
  t.innerHTML = `<span class="toast-icon">${error ? ICONS.alert : ICONS.check}</span><span></span>`;
  t.lastChild.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), error ? 5000 : 2600);
}

document.querySelectorAll('[data-win]').forEach((b) => (b.onclick = () => api.windowControl(b.dataset.win)));

if (isMac) { document.body.classList.add('mac'); $('addKbd').textContent = '⌘N'; }
refresh();
setInterval(() => { if ($('overlay').hidden) refresh(); }, 5000);
