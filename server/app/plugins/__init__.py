"""插件、Skill 与市场（B3b）。

- `registry.py`：读 `server/registry/*.json`（build_registry.py 生成）。
- `host.py`：后台事件循环线程，持有全部 MCP 会话（每插件一个），空闲回收、单次超时。
- `mapping.py`：工具结果按 evidence_mapping 转成 EvidenceDraft。
- `store.py`：plugins / conversation_plugins 表的读写与配置合并（密钥加密存储）。
- `runtime.py`：模块级对象 `plugins`，实现 `app.agent.hooks.PluginService`，并提供安装自检等接口用的方法。
"""
