# 阶段 2 验证记录

验证日期：2026-07-15（Asia/Shanghai）

## 六表与同步

- 六张表名称严格为：项目、分镜、资产、生成任务、质检、出海实验。
- `pnpm feishu:setup` 在无凭证环境输出 `mode: dry-run` 和六表全部字段，确认未发网络请求。
- Base reconcile 单元测试使用可观测 fake OpenAPI：第一次创建六表，第二次全部 `validated`，同名错类型字段会失败。
- 双向记录同步测试覆盖 create、update、unchanged 抑制，以及仅接收更新 remote revision 的入站变更。

## Webhook 安全

单元测试覆盖：

- 官方签名公式：`sha256(timestamp + nonce + encryptKey + rawBody)`。
- 错误签名拒绝。
- 超过 5 分钟的重放时间戳拒绝。
- AES-256-CBC 解密后再校验 Verification Token。
- Fastify 保留原始 body，错误 Token 返回 401。
- 未配置 Verification Token 时路由返回 503，失败关闭。
- URL verification challenge 原样返回。

## 四动作、版本、操作者、幂等与审计

真实 PostgreSQL 集成测试 3/3 通过：

1. 在第一条数据库连接创建持久化人工闸门，关闭连接；在第二条连接分别执行 `approve`、`regenerate`、`switch_provider`、`manual`，证明暂停/恢复不依赖进程内存。
2. 每个事件重复投递时命中幂等 replay，动作 runtime 只调用一次。
3. `manual` 将闸门置为 `cancelled`，其余动作置为 `resolved`。
4. 四个 accepted 动作均写入 `audit_logs`。
5. 未授权操作者被拒绝，闸门保持 `waiting`。
6. 目标版本不匹配被拒绝，幂等 reservation 被释放，正确版本的新事件可以恢复。

数据库迁移 `0001_feishu-control.sql` 新增：`human_gates`、`audit_logs`、`feishu_record_links`。

## 当前边界

- 真实飞书 App/Base 凭证不存在，所以 Base OpenAPI、真实卡片投递和真实租户事件尚未实测，明确列为 `未实测`。
- 四动作已经进入持久化闸门和动作 runtime；Provider 任务创建和 LangGraph checkpoint 的实际业务恢复将在阶段 4/工作流闭环继续接通。
