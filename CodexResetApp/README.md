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

v0.1.11 的历史统计直接使用 CodexBar 的原生去重与计价报告，并自动替换旧版派生
统计；首次整理显示进度。计算页与用量页共用分段控件，主线按钮采用更大的字号，
仍支持横排和原位连续操作。

v0.1.13 将公告、完成消息与实际刷新按同一事件对账；主页和时间轴保持一致，
另一个账号缺少证据时显示“未确认”。已完成的旧消息及仍使用旧刷新时间的概率
不会继续把新周期推向 100% 目标，历史记录保持原样。

v0.1.14 将历史整理改为真正打开“用量与目标”后按需执行：每次只处理界面当前选择的
日期范围和分日时区，本机记录没有变化时不再启动 CodexBar 全量扫描，未完成的活跃日志也不会
在后台自行循环追赶。低电量模式只读取已确认历史；恢复供电后再按需低优先级更新。

原生界面回归可用 `scripts/render-reset-delivery-fixture.js` 生成匿名生产快照，
再以 `CODEX_RESET_DEMO_SNAPSHOT=/absolute/path/snapshot.json` 和
`--readme-demo=zh`（或 `en`）运行实际 App。该模式不启动采集器、不读真实账户，
仍使用正式菜单布局和交互；无效快照会停止演示，不会悄悄换成其他示例。

## 下载版的首次打开

公开 Release 同时提供带“Applications”拖拽入口的 DMG、ZIP 与 SHA-256 校验和。
下载包使用 macOS ad-hoc 签名，没有 Apple Developer ID 公证。首次打开如果被
Gatekeeper 拦截，请在 Finder 中按住 Control 点按应用并选择“打开”；如果系统仍然
阻止，请前往“系统设置 → 隐私与安全性”，确认应用来源后选择“仍要打开”。

下载包与源码构建使用相同代码。建议仅从本仓库的 GitHub Releases 下载，并在安装
前核对 Release 页面公布的 SHA-256。
