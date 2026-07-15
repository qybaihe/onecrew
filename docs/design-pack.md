# Design Pack 编译与接入

OneCrew 把 Open Design 的 `DESIGN.md` 当作受控输入，而不是运行时代码或正式视频渲染器。编译入口是：

```bash
pnpm design:compile
```

默认输入位于 `design-packs/shanhai-demo`，输出当前快照到包根目录，同时把不可变历史写入：

```text
design-packs/shanhai-demo/versions/<semver>_<content-hash-prefix>/
```

## 输入约定

`DESIGN.md` 需要一级标题，并可声明九类二级章节：Color、Typography、Spacing、Layout、Components、Motion、Voice、Brand、Anti-patterns。缺失章节会使用系统默认值，同时明确写入 `compile-report.json` 的 `warnings`，不会静默吞掉。

资源目录约定：

- `assets/`：Logo、纹理、背景等；有文件时必须存在 `assets/LICENSES.md`，且每个文件都要有来源条目。
- `templates/`：标题卡、名牌、片尾、海报框；必须由 `templates/LICENSES.md` 覆盖。
- `fonts/`：可选字体文件；一旦存在字体，必须由 `fonts/LICENSE.md` 覆盖。

清单的 `sourceLicense` 还会记录整个设计系统的来源与许可证。示例包全部为本项目原创 SVG，不含第三方字体和图片。

## 输出契约

每个版本包含：

- `DESIGN.md`
- `brand.tokens.json`
- `motion.tokens.json`
- `promo.spec.json`
- `compile-report.json`
- `manifest.json`
- 已校验的资产、模板和字体副本

版本键由语义版本和 SHA-256 内容哈希组成。哈希覆盖 Markdown、标准化令牌、宣传结构、资源文件字节、设计系统 ID、版本与许可证。相同内容重复编译会读取原 `createdAt` 并逐字节校验旧快照；任何同版本路径覆写都会失败。`loadCompiledDesignPack()` 会用共享 Schema 重新验证全部 JSON、URI、资源存在性和清单/报告一致性，供后续 Remotion ThemeProvider 直接消费。

## 安全校验

- `DESIGN.md` 最大 1 MiB，禁止远程 URL；远程资源必须先进入受控存储。
- 禁止 Design Pack 内的符号链接。
- SVG 禁止脚本、`foreignObject`、事件处理器、`javascript:` 和远程 `href`。
- 正文与背景色最低对比度为 4.5:1。
- 颜色、数字范围、动效密度和 Manifest 均由 Zod 严格校验。
- Open Design/HyperFrames 不参与正式 MP4 输出；Remotion 是唯一正式渲染链。

Open Design 格式来源与框架许可见[官方仓库](https://github.com/nexu-io/open-design)。导入的每个具体设计系统、字体、模板和媒体仍须分别核对许可证。
