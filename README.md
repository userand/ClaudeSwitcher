# Claude Switcher

在多个 Claude 桌面版账号之间一键切换，支持 Windows 和 macOS。

## 原理

Claude 桌面版的登录状态存在它的数据目录里：

| 系统 | 数据目录 | 账号快照目录 |
|---|---|---|
| Windows | `%APPDATA%\Claude` | `%LOCALAPPDATA%\ClaudeDesktopProfiles` |
| macOS | `~/Library/Application Support/Claude` | `~/Library/Application Support/ClaudeDesktopProfiles` |

切换时：关闭 Claude → 把当前账号的 `Network`、`Local Storage`、`Session Storage`、`IndexedDB`、`WebStorage` 和 `config.json` 里的 `oauth:*` 字段存成快照 → 放回目标账号的快照 → 重新打开 Claude。
其余设置、会话记录、`vm_bundles` 等两个账号共用，不复制。每次改写 `config.json` 前会备份为 `config.json.switcher-bak`。

## 使用

1. 打开 Claude Switcher，给 Claude 里当前登录的账号起个名字（「登记」）。
2. 点「添加新账号」，Claude 会重启并退出登录，在里面登录第二个账号。
3. 之后点对应账号的「切换」即可。

## 开发与打包

```bash
npm install
npm start          # 运行
npm test           # 核心逻辑测试（在临时目录里模拟，不碰真实数据）
npm run dist:win   # 打包 Windows 安装包 → dist/
npm run dist:mac   # 打包 Mac 版（必须在 Mac 上运行）→ dist/
```

Mac 版只能在 Mac 上打包。发布新版本时推送 `v*` 标签（如 `git tag v1.2.0 && git push origin v1.2.0`），
GitHub Actions 会在 Windows 和 macOS 上分别打包并自动创建 Release；也可以在 Actions 页面手动运行 `build`，只打包不发布。
Mac 版未签名，第一次打开时需右键 → 打开。

`test/preview.html` 是用假数据预览界面的页面，用任意静态服务器打开即可。
