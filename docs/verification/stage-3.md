# 阶段 3 验证记录

验证日期：2026-07-15（Asia/Shanghai）

## 实际编译

连续两次运行 `pnpm design:compile` 均得到同一结果：

```text
designSystemId: design_shanhai_demo
version: 1.0.0
contentHash: c590888620ae34c2d255004b6c1ba9ebdb329fbe9f0e8073aa53284120f65759
versionDirectory: design-packs/shanhai-demo/versions/1.0.0_c590888620ae
warnings: []
```

编译报告确认 Color、Typography、Spacing、Layout、Components、Motion、Voice、Brand、Anti-patterns 九类规则全部为 `parsed`。版本目录包含输入 Markdown、4 份 JSON 契约文件、Manifest、编译报告、2 个资产、4 个模板和两份来源/许可证清单。

## 自动测试

- 单元测试：1 个文件、2 个用例通过，覆盖九节归一化、标签/列表解析和缺失一级标题拒绝。
- 集成测试：1 个文件、4 个用例通过。
  - 首次编译生成完整不可变快照，第二次编译保持 Manifest、哈希、目录与时间戳一致。
  - `loadCompiledDesignPack()` 从版本目录严格加载，并校验 Manifest、编译报告、Token 与所有资产。
  - 改动任一 SVG 字节会生成新内容哈希和新版本目录，不覆写旧版本。
  - 脚本 SVG、远程资源和低于 4.5:1 的颜色对比度会被拒绝。
- TypeScript 类型检查和 ESLint 均通过。

## 可追踪历史

阶段实现过程中先产生 `1.0.0_c4220d8258be`，随后新增模板逐文件许可证清单，使内容哈希变为 `1.0.0_c590888620ae`。旧目录没有被覆盖，保留为“设计包变化产生新快照”的真实证据；根目录 Manifest 指向最新版本。

## 当前边界

- Open Design Adapter 只编译并加载 Design Pack，不生成 MP4。
- Remotion ThemeProvider 与六个 Composition 尚属阶段 5；当前 loader 已提供它们需要的严格、稳定输入边界。
- 示例包没有捆绑字体文件，使用系统字体回退。未来导入字体时，缺少 `fonts/LICENSE.md` 或来源条目会失败。
