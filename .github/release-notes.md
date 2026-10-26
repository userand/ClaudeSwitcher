在多个 Claude 桌面版账号之间一键切换。

## 下载

| 系统 | 文件 |
|---|---|
| Windows 10 / 11 | `ClaudeSwitcher-*-win-setup.exe` |
| macOS（Apple 芯片 M1/M2/M3/M4） | `ClaudeSwitcher-*-mac-arm64.dmg` |
| macOS（Intel 芯片） | `ClaudeSwitcher-*-mac-x64.dmg` |

## 安装说明

**Windows**：双击安装包，自动安装并在桌面创建快捷方式。安装包未做代码签名，如果出现「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」。

**macOS**：打开 dmg，把 Claude Switcher 拖进「应用程序」。应用未签名，第一次打开请在「应用程序」里右键 → 打开。
如果提示「已损坏，无法打开」，在终端运行：

```
xattr -cr "/Applications/Claude Switcher.app"
```

## 使用

1. 打开后给 Claude 里当前登录的账号起个名字（登记）。
2. 点「添加账号」，Claude 会重启并退出登录，在里面登录第二个账号。
3. 之后点「切换」或按数字键 1–9 即可切换。

切换会关闭并重启 Claude，正在进行的对话会中断。
