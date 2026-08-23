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
CodexBar 保持运行。若原有 CodexBar Monitor 已占用 `127.0.0.1:18765`，独立应用会
复用它，两套界面仍然得到同一份结果。服务地址也可以在应用设置中修改。

## 下载版的首次打开

公开下载包使用 macOS ad-hoc 签名，没有 Apple Developer ID 公证。首次打开如果被
Gatekeeper 拦截，请在 Finder 中按住 Control 点按应用并选择“打开”；如果系统仍然
阻止，请前往“系统设置 → 隐私与安全性”，确认应用来源后选择“仍要打开”。

下载包与源码构建使用相同代码。建议仅从本仓库的 GitHub Releases 下载，并在安装
前核对 Release 页面公布的 SHA-256。
