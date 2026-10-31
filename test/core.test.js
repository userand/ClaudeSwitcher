// 在临时目录里模拟 Claude 数据目录，验证登记 / 添加 / 来回切换 / 重命名 / 删除
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Switcher } = require('../src/core');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-switcher-test-'));
const dataDir = path.join(root, 'data');
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const r = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const cfg = () => JSON.parse(r(path.join(dataDir, 'config.json')));

w(path.join(dataDir, 'Network', 'Cookies'), 'COOKIE-A');
w(path.join(dataDir, 'Cookies'), 'MAC-COOKIE-A');
w(path.join(dataDir, 'Local Storage', 'leveldb', 'x.ldb'), 'LS-A');
w(path.join(dataDir, 'vm_bundles', 'big.bin'), 'SHARED');
w(path.join(dataDir, 'config.json'), JSON.stringify({ locale: 'zh-CN', nested: { a: [1] }, 'oauth:tokenCache': 'TOK-A', lastKnownAccountUuid: 'uuid-a' }));

(async () => {
  const s = new Switcher({ dataDir, profileRoot: path.join(root, 'profiles'), noProcess: true });

  s.register('主账号');
  assert.strictEqual(s.getActive(), '主账号');

  await s.addNew('备用账号');
  assert.strictEqual(r(path.join(dataDir, 'Network', 'Cookies')), null, '新账号应清空登录');
  assert.strictEqual(r(path.join(dataDir, 'Cookies')), null, '新账号应清空 macOS 的 Cookies');
  assert.strictEqual(cfg()['oauth:tokenCache'], undefined);
  assert.strictEqual(cfg().locale, 'zh-CN', '其他设置应保留');

  // 模拟在 Claude 里登录 B
  w(path.join(dataDir, 'Network', 'Cookies'), 'COOKIE-B');
  w(path.join(dataDir, 'config.json'), JSON.stringify({ ...cfg(), 'oauth:tokenCache': 'TOK-B', lastKnownAccountUuid: 'uuid-b' }));

  const steps = [];
  await s.switchTo('主账号', (st) => steps.push(st));
  assert.deepStrictEqual(steps, ['stop', 'save', 'restore', 'start']);
  assert.strictEqual(r(path.join(dataDir, 'Network', 'Cookies')), 'COOKIE-A');
  assert.strictEqual(r(path.join(dataDir, 'Cookies')), 'MAC-COOKIE-A');
  assert.strictEqual(r(path.join(dataDir, 'Local Storage', 'leveldb', 'x.ldb')), 'LS-A');
  assert.strictEqual(cfg()['oauth:tokenCache'], 'TOK-A');
  assert.deepStrictEqual(cfg().nested, { a: [1] });

  await s.switchTo('备用账号');
  assert.strictEqual(r(path.join(dataDir, 'Network', 'Cookies')), 'COOKIE-B');
  assert.strictEqual(r(path.join(dataDir, 'Local Storage', 'leveldb', 'x.ldb')), null, 'B 没有 Local Storage');
  assert.strictEqual(cfg().lastKnownAccountUuid, 'uuid-b');

  await s.switchTo('主账号');
  assert.strictEqual(cfg()['oauth:tokenCache'], 'TOK-A');
  assert.strictEqual(r(path.join(dataDir, 'vm_bundles', 'big.bin')), 'SHARED', '共享数据不应被动到');

  s.rename('主账号', 'Alex');
  assert.strictEqual(s.getActive(), 'Alex');
  assert.throws(() => s.remove('Alex'), /当前正在使用/);
  s.remove('备用账号');
  assert.deepStrictEqual(s.listProfiles().map((p) => p.name), ['Alex']);
  assert.throws(() => s.register(''), /不能为空/);
  await assert.rejects(s.switchTo('不存在'), /没有名为/);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('全部通过 ✓');
})().catch((e) => { console.error(e); process.exit(1); });
