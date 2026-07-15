# 阶段 1 验证记录

验证日期：2026-07-15（Asia/Shanghai）

## 契约

- `packages/contracts/src/index.ts` 是 Project、Shot、Asset、Job、QC、Render、Design Pack 和 Locale Pack 的共享 Zod 源。
- `pnpm contracts:generate` 已生成 9 份 JSON Schema Draft 2020-12 文件。
- 语言枚举只有 `zh-CN` 和 `en-US`；Composition 枚举只有蓝图锁定的 6 项。
- 契约单元测试：5/5 通过，覆盖语言边界、本地化时序、Composition 闭集和 JSON Schema 转换。

## 状态机、版本与哈希

- Project、Shot、Asset、Job、Render 均有显式允许转换表。
- `waiting_human` 可持久化并恢复为 `queued`/`running` 路径；成功和取消状态不可被静默重开。
- 乐观锁要求 `expectedVersion` 与数据库当前版本一致。
- 输入哈希对 JSON 对象键顺序稳定；非 JSON 值会被拒绝，避免幂等歧义。
- Domain 单元测试：7/7 通过。

## PostgreSQL migration 与 repository

Drizzle 生成并检查 `packages/db/migrations/0000_init.sql`：

```text
7 tables
assets
idempotency_keys
jobs
projects
qc_records
renders
shots
drizzle-kit check -> Everything's fine
```

Repository 集成测试连接真实 PostgreSQL，3/3 通过，覆盖：

1. Project 创建、合法转换、非法转换、过期版本拒绝。
2. 幂等 reserve、in-progress、complete、replay，以及同键不同输入冲突。
3. Shot、Asset、Job、QC、Render 的真实写入与各自状态转换，其中 Job 覆盖人工暂停/恢复，QC 覆盖 `regenerate`，Render 覆盖 `queued -> running -> succeeded`。

## 从空数据库复现

本轮创建一次性空库 `onecrew_stage1_verify`，使用工程命令执行：

```text
pnpm db:migrate -> PASS
pnpm db:seed    -> PASS
```

随后直接查询得到：

```text
public app tables = 7
projects = 1
shots = 2
```

验证后仅删除了本轮创建的临时数据库；常规 `onecrew` 开发库保留。

## 当前边界

- 本阶段证明领域与运行真相层，不代表飞书同步、Provider、工作流或 Remotion 已实现。
- `shanhai-demo` 现阶段 seed 只有项目和 2 个骨架镜头；阶段 8 会扩充为 8～12 镜头固定演示项目。
