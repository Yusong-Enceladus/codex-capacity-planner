# Codex Capacity Planner for macOS

> 非 OpenAI 官方产品。本项目与 OpenAI 没有隶属或背书关系。

独立的 macOS 菜单栏客户端。它从本机 `Codex Capacity Planner Monitor` 的
`/api/snapshot` 读取与 CodexBar 插件相同的决策结果，因此两种界面共享同一套预测、
强制刷新、重置券、账户和诊断逻辑。

```sh
./build-app.sh
open "dist/Codex Capacity Planner.app"
```

应用包内包含本机 Monitor 和额度采集 helper；打开后会自行启动服务，不要求
CodexBar 保持运行。应用与 Monitor 共用内部固定端点，并通过内容指纹接管过期的
内置 Monitor；服务地址不会显示在设置中，也不需要用户填写。

“用量与目标”的每个账号进度条下显示本机每日历史：7/30/90 天及自定 1–365 天、
API 等价估算/Token、日期选择与收起的模型/工作区/任务明细。中文按 UTC+8、
英文按太平洋时间分日。没有可靠账号归属的旧记录单列，不按当前登录账号猜测。
后台采集和历史存储已经随 App 打包，无需额外安装或配置。

## 下载版的首次打开

公开 Release 同时提供带“Applications”拖拽入口的 DMG、ZIP 与 SHA-256 校验和。
下载包使用 macOS ad-hoc 签名，没有 Apple Developer ID 公证。首次打开如果被
Gatekeeper 拦截，请在 Finder 中按住 Control 点按应用并选择“打开”；如果系统仍然
阻止，请前往“系统设置 → 隐私与安全性”，确认应用来源后选择“仍要打开”。

下载包与源码构建使用相同代码。建议仅从本仓库的 GitHub Releases 下载，并在安装
前核对 Release 页面公布的 SHA-256。
