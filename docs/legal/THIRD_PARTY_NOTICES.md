# 第三方软件声明

生效日期：2026-05-31

Nolia 使用 Electron、React、CodeMirror、Tiptap、unified/remark/rehype 等第三方开源软件。每次正式发布都应根据最终 `package-lock.json` 和打包产物维护第三方声明。

本文列出当前项目直接运行时依赖及其许可证摘要。传递依赖的许可证审计纳入发布流程，并应随正式发布包或发布页面保留完整声明。

| 软件包 | 当前版本 | 许可证 |
|---|---:|---|
| @ai-sdk/openai | 3.0.71 | Apache-2.0 |
| @ai-sdk/openai-compatible | 2.0.50 | Apache-2.0 |
| @codemirror/commands | 6.10.3 | MIT |
| @codemirror/lang-html | 6.4.11 | MIT |
| @codemirror/lang-javascript | 6.2.5 | MIT |
| @codemirror/lang-json | 6.0.2 | MIT |
| @codemirror/lang-markdown | 6.5.0 | MIT |
| @codemirror/lang-xml | 6.1.0 | MIT |
| @codemirror/lang-yaml | 6.1.3 | MIT |
| @codemirror/language | 6.12.3 | MIT |
| @codemirror/lint | 6.9.6 | MIT |
| @codemirror/state | 6.6.0 | MIT |
| @codemirror/view | 6.43.0 | MIT |
| @tiptap/core | 3.23.6 | MIT |
| @tiptap/extension-code | 3.23.6 | MIT |
| @tiptap/extension-code-block-lowlight | 3.23.6 | MIT |
| @tiptap/extension-image | 3.23.6 | MIT |
| @tiptap/extension-placeholder | 3.23.6 | MIT |
| @tiptap/extension-table | 3.23.6 | MIT |
| @tiptap/extension-task-item | 3.23.6 | MIT |
| @tiptap/extension-task-list | 3.23.6 | MIT |
| @tiptap/pm | 3.23.6 | MIT |
| @tiptap/react | 3.23.6 | MIT |
| @tiptap/starter-kit | 3.23.6 | MIT |
| @uiw/react-codemirror | 4.25.10 | MIT |
| ai | 6.0.206 | Apache-2.0 |
| chokidar | 5.0.0 | MIT |
| electron | 42.5.0 | MIT |
| highlight.js | 11.11.1 | BSD-3-Clause |
| katex | 0.17.0 | MIT |
| lowlight | 3.3.0 | MIT |
| lucide-react | 1.16.0 | ISC |
| mdast-util-to-string | 4.0.0 | MIT |
| mermaid | 11.16.0 | MIT |
| mime-types | 3.0.2 | MIT |
| react | 19.2.6 | MIT |
| react-dom | 19.2.6 | MIT |
| rehype-highlight | 7.0.2 | MIT |
| rehype-katex | 7.0.1 | MIT |
| rehype-parse | 9.0.1 | MIT |
| rehype-raw | 7.0.0 | MIT |
| rehype-remark | 10.0.1 | MIT |
| rehype-sanitize | 6.0.0 | MIT |
| rehype-stringify | 10.0.1 | MIT |
| remark-gfm | 4.0.1 | MIT |
| remark-math | 6.0.0 | MIT |
| remark-parse | 11.0.0 | MIT |
| remark-rehype | 11.1.2 | MIT |
| remark-stringify | 11.0.0 | MIT |
| sanitize-filename | 1.6.4 | WTFPL OR ISC |
| sql.js | 1.14.1 | MIT |
| unified | 11.0.5 | MIT |
| unist-util-visit | 5.1.0 | MIT |
| yaml | 2.9.0 | ISC |
| zod | 4.4.3 | MIT |
| zustand | 5.0.13 | MIT |

## 发布维护

每次正式发布时应执行：

1. 基于锁文件生成完整依赖许可证清单。
2. 检查 Electron、Chromium、Node.js 相关声明要求。
3. 检查图标、字体、示例图片和测试资源的授权。
4. 将完整声明随 App 或官网发布。
