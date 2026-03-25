import { describe, it, expect } from 'vitest';

import { FeishuChannel } from './feishu.js';

const TEST_MARKDOWN = `# Markdown 渲染测试

## 一、标题

# H1
## H2
### H3
#### H4
##### H5
###### H6

---

## 二、文本样式

**粗体 Bold**
*斜体 Italic*
***粗斜体 Bold Italic***
~~删除线~~
\`行内代码\`
==高亮==

组合：**粗体 + *斜体* + \`代码\` + ~~删除~~ + ==高亮==**

---

## 三、列表

### 无序列表
- 根节点
  - 子节点 A
  - 子节点 B
    - 叶子节点
- 另一个根节点

### 有序列表
1. 第一步
2. 第二步
   1. 子步骤 2.1
   2. 子步骤 2.2
3. 第三步

### 任务列表
- [x] 已完成
- [ ] 进行中
- [ ] 待处理

---

## 四、引用

> 单层引用
>> 嵌套引用
>>> 三层嵌套

> 引用中含**粗体**、\`代码\`、[链接](https://www.baidu.com)

---

## 五、代码块

\`\`\`python
def calculate_stats(data):
    total = sum(data)
    avg = total / len(data)
    return {"total": total, "average": avg, "count": len(data)}

result = calculate_stats([10, 20, 30, 40, 50])
print(result)
\`\`\`

\`\`\`javascript
const fetchData = async (url) => {
  const res = await fetch(url);
  return await res.json();
};
fetchData("https://api.example.com").then(console.log);
\`\`\`

\`\`\`bash
echo "Build started"
npm run build && echo "Success"
\`\`\`

---

## 六、表格

| 功能 | 优先级 | 负责人 | 进度 |
|------|--------|--------|------|
| 用户认证 | 高 | 小明 | ✅ 100% |
| 数据导出 | 中 | 小红 | 🔄 75% |
| 报表生成 | 低 | 小刚 | ⏳ 30% |
| 权限管理 | 高 | 小李 | ❌ 0% |

---

## 七、分隔线

---

上方分隔线

---

下方分隔线

---

## 八、链接

[百度](https://www.baidu.com) · [GitHub](https://github.com)

---

## 九、复杂组合测试

### 组合 A：引用 + 表格 + 列表

> **本周项目状态**
>
> | 项目 | 负责人 | 完成度 |
> |------|--------|--------|
> | 前端重构 | 小王 | 80% |
> | 后端优化 | 小李 | 60% |
>
> 待办事项：
> 1. 代码评审
> 2. 编写单元测试
> 3. 上线部署

### 组合 B：任务列表 + 代码块

- [x] 实现核心算法
  \`\`\`python
  def core_algorithm(data):
      return [x * 2 for x in data if x > 0]
  \`\`\`
- [ ] 编写单元测试
  \`\`\`python
  def test_core():
      assert core_algorithm([1, -2, 3]) == [2, 6]
  \`\`\`
- [ ] 编写使用文档

### 组合 C：有序 + 无序列表 + 代码块

1. 环境初始化
   - 检查版本
     \`\`\`bash
     node -v && npm -v
     \`\`\`
   - 安装依赖
     \`\`\`bash
     npm install && npm start
     \`\`\`
2. 开发阶段
   - 创建 \`app.js\`
     \`\`\`javascript
     const app = require('express')();
     app.listen(3000);
     \`\`\`

### 组合 D：表格 + 嵌套列表 + 引用

| 任务 | 子任务 | 状态 |
|------|--------|------|
| 测点质量核对 | - 坏点判断优化<br>- 趋势异常判断 | 🔄 进行中 |
| 专家评审 | > 效果提升明显 | ✅ 已完成 |

### 组合 E：完整联合场景

- 测点质量核对工具优化
  - **已完成**：测点类型判断、死点判断、大模型坏点判断逻辑
  - **效果对比**：
    | 指标 | 优化前 | 优化后 |
    |------|--------|--------|
    | 准确率 | 85% | 92% |
    | 召回率 | 78% | 88% |
  - > 专家建议：扩大测试数据集，验证效果稳定性
  - 核心代码：
    \`\`\`python
    def detect_bad_points(data, threshold=0.8):
        return [p for p in data if p.confidence < threshold]
    \`\`\`

---

## 十、HTML 行内元素

| 写法 | 效果 |
|------|------|
| \`<br>\` | 第一行<br>第二行 |
| \`<u>\` | <u>下划线</u> |
| \`<kbd>\` | <kbd>Ctrl</kbd>+<kbd>S</kbd> |
| \`<mark>\` | <mark>高亮</mark> |
| \`&nbsp;\` | 空格&nbsp;&nbsp;&nbsp;测试 |
| \`<sub>\` | H<sub>2</sub>O |
| \`<sup>\` | x<sup>2</sup> |

---

**测试完毕，请反馈哪些元素显示异常，我来针对性修复！**`;

// Access private methods via Reflect
function getPrivateStatic<T>(
  cls: new (...args: never[]) => T,
  name: string,
): Function {
  return Reflect.get(cls, name) as Function;
}

// Instance method accessor - creates a minimal instance
function getPrivateInstance<T extends object>(
  instance: T,
  name: string,
): Function {
  const method = Reflect.get(instance, name) as Function;
  return method.bind(instance);
}

describe('FeishuChannel markdown parsing', () => {
  describe('_detectMsgFormat', () => {
    const detectMsgFormat = getPrivateStatic(
      FeishuChannel,
      '_detectMsgFormat',
    ).bind(FeishuChannel);

    it('detects text format for short plain text', () => {
      expect(detectMsgFormat('Hello world')).toBe('text');
    });

    it('detects post format for text with links', () => {
      expect(detectMsgFormat('[link](https://example.com)')).toBe('post');
    });

    it('detects interactive format for code blocks', () => {
      expect(detectMsgFormat('```python\ncode```')).toBe('interactive');
    });

    it('detects interactive format for markdown tables', () => {
      const table = `| Header |
|--------|
| Cell   |`;
      expect(detectMsgFormat(table)).toBe('interactive');
    });

    it('detects interactive format for headings', () => {
      expect(detectMsgFormat('# Heading')).toBe('interactive');
    });

    it('detects interactive format for bold text', () => {
      expect(detectMsgFormat('**bold**')).toBe('interactive');
    });

    it('detects interactive format for italic text', () => {
      expect(detectMsgFormat('*italic*')).toBe('interactive');
    });

    it('detects interactive format for strikethrough', () => {
      expect(detectMsgFormat('~~strike~~')).toBe('interactive');
    });

    it('detects interactive format for unordered lists', () => {
      expect(detectMsgFormat('- item')).toBe('interactive');
    });

    it('detects interactive format for ordered lists', () => {
      expect(detectMsgFormat('1. item')).toBe('interactive');
    });

    it('detects post format for medium plain text', () => {
      const longText = 'a'.repeat(500);
      expect(detectMsgFormat(longText)).toBe('post');
    });

    it('detects interactive format for very long content', () => {
      const veryLongText = '# Title\n\n' + 'a'.repeat(3000);
      expect(detectMsgFormat(veryLongText)).toBe('interactive');
    });
  });

  describe('_stripMdFormatting', () => {
    const stripMdFormatting = getPrivateStatic(
      FeishuChannel,
      '_stripMdFormatting',
    ).bind(FeishuChannel);

    it('strips bold markers', () => {
      expect(stripMdFormatting('**bold**')).toBe('bold');
    });

    it('strips underscore bold markers', () => {
      expect(stripMdFormatting('__bold__')).toBe('bold');
    });

    it('strips italic markers', () => {
      expect(stripMdFormatting('*italic*')).toBe('italic');
    });

    it('strips strikethrough markers', () => {
      expect(stripMdFormatting('~~strike~~')).toBe('strike');
    });

    it('handles combined formatting', () => {
      expect(stripMdFormatting('**bold** and *italic*')).toBe(
        'bold and italic',
      );
    });
  });

  describe('_parseMdTable', () => {
    const parseMdTable = getPrivateStatic(FeishuChannel, '_parseMdTable').bind(
      FeishuChannel,
    );

    it('parses valid markdown table', () => {
      const table = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`;

      const result = parseMdTable(table);

      expect(result).not.toBeNull();
      expect(result!.tag).toBe('table');
      expect(result!.columns).toHaveLength(2);
      expect(result!.rows).toHaveLength(1);
      expect(result!.rows[0].c0).toBe('Cell 1');
      expect(result!.rows[0].c1).toBe('Cell 2');
    });

    it('returns null for invalid table (less than 3 lines)', () => {
      expect(parseMdTable('| Header |\n|----------|')).toBeNull();
      expect(parseMdTable('| Header |')).toBeNull();
    });

    it('strips markdown formatting from cell content', () => {
      const table = `| **Bold** | *Italic* |
|----------|----------|
| **Cell** | ~~strike~~ |`;

      const result = parseMdTable(table);

      // rows contains data rows (lines after separator), not header
      // rows[0] is the third line (Cell row), not the header (Bold row)
      expect(result!.rows[0].c0).toBe('Cell');
      expect(result!.rows[0].c1).toBe('strike');
    });
  });

  describe('_splitElementsByTableLimit', () => {
    const splitElementsByTableLimit = getPrivateStatic(
      FeishuChannel,
      '_splitElementsByTableLimit',
    ).bind(FeishuChannel);

    it('groups elements with at most 1 table per group', () => {
      const elements = [
        { tag: 'markdown' as const, content: 'before' },
        { tag: 'table' as const, page_size: 2, columns: [], rows: [] },
        { tag: 'markdown' as const, content: 'middle' },
        { tag: 'table' as const, page_size: 2, columns: [], rows: [] },
        { tag: 'markdown' as const, content: 'after' },
      ];

      const groups = splitElementsByTableLimit(elements, 1);

      // With maxTables=1, each group can have at most 1 table
      // Current implementation:
      // - Process markdown('before')
      // - Process table0 -> tableCount=1
      // - Process markdown('middle') -> tableCount(1) >= maxTables(1)? YES -> push [markdown, table], reset
      // - Process table1 -> tableCount=1
      // - Process markdown('after')
      // - Push at end
      // Result: [[markdown, table], [markdown, table, markdown]] = 2 groups
      expect(groups.length).toBeGreaterThanOrEqual(2);
      // Verify each group has at most 1 table
      for (const group of groups) {
        const tableCount = group.filter((e: any) => e.tag === 'table').length;
        expect(tableCount).toBeLessThanOrEqual(1);
      }
    });

    it('allows multiple tables when maxTables > 1', () => {
      const elements = [
        { tag: 'table' as const, page_size: 2, columns: [], rows: [] },
        { tag: 'table' as const, page_size: 2, columns: [], rows: [] },
      ];

      const groups = splitElementsByTableLimit(elements, 2);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(2);
    });

    it('returns [[]] for empty input', () => {
      expect(splitElementsByTableLimit([], 1)).toEqual([[]]);
    });
  });

  describe('_splitHeadings (instance method)', () => {
    // Cast prototype to any to access private instance methods
    const channel = FeishuChannel.prototype as any;

    it('splits content by headings', () => {
      const content = '# Title\n\nSome text\n\n## Subtitle\n\nMore text';

      const elements = channel._splitHeadings(content);

      // Should have div elements for headings and markdown for text
      const headingElements = elements.filter((e: any) => e.tag === 'div');
      const markdownElements = elements.filter(
        (e: any) => e.tag === 'markdown',
      );

      expect(headingElements).toHaveLength(2);
      expect(markdownElements).toHaveLength(2);
    });

    it('converts horizontal rules to hr elements', () => {
      const content = 'Text\n\n---\n\nMore text';

      const elements = channel._splitHeadings(content);

      const hrElements = elements.filter((e: any) => e.tag === 'hr');
      expect(hrElements).toHaveLength(1);
    });

    it('protects code blocks from heading parsing', () => {
      const content = '# Title\n\n```\n# Not a heading\n```';

      const elements = channel._splitHeadings(content);

      const markdownElements = elements.filter(
        (e: any) => e.tag === 'markdown',
      );
      // The code block should be preserved in markdown content
      const codeBlockContent = markdownElements.find((e: any) =>
        e.content.includes('```'),
      );
      expect(codeBlockContent).toBeDefined();
    });
  });

  describe('_buildCardElements (instance method)', () => {
    // Cast prototype to any to access private instance methods
    const channel = FeishuChannel.prototype as any;

    it('builds card elements from markdown content', () => {
      const content = '# Heading\n\nSome text';

      const elements = channel._buildCardElements(content);

      expect(elements.length).toBeGreaterThan(0);
      expect(elements[0]).toHaveProperty('tag');
    });

    it('extracts tables as table elements', () => {
      const content = `# Title

| Col1 | Col2 |
|------|------|
| A    | B    |`;

      const elements = channel._buildCardElements(content);

      const tableElements = elements.filter((e: any) => e.tag === 'table');
      expect(tableElements.length).toBe(1);
    });
  });

  describe('_markdownToPost', () => {
    const markdownToPost = getPrivateStatic(
      FeishuChannel,
      '_markdownToPost',
    ).bind(FeishuChannel);

    it('converts markdown links to post format', () => {
      const content = '[百度](https://www.baidu.com)';

      const result = markdownToPost(content);

      expect(result.zh_cn.content[0][0].tag).toBe('a');
      expect(result.zh_cn.content[0][0].text).toBe('百度');
      expect(result.zh_cn.content[0][0].href).toBe('https://www.baidu.com');
    });

    it('handles plain text lines', () => {
      const content = 'Just plain text';

      const result = markdownToPost(content);

      expect(result.zh_cn.content[0][0].tag).toBe('text');
      expect(result.zh_cn.content[0][0].text).toBe('Just plain text');
    });

    it('handles empty lines as empty paragraphs', () => {
      const content = 'Line 1\n\nLine 3';

      const result = markdownToPost(content);

      expect(result.zh_cn.content).toHaveLength(3); // Line 1, empty, Line 3
    });
  });

  describe('Full markdown test document', () => {
    const detectMsgFormat = getPrivateStatic(
      FeishuChannel,
      '_detectMsgFormat',
    ).bind(FeishuChannel);
    const channel = FeishuChannel.prototype as any;
    const splitElementsByTableLimit = getPrivateStatic(
      FeishuChannel,
      '_splitElementsByTableLimit',
    ).bind(FeishuChannel);

    it('detects interactive format for complex markdown', () => {
      expect(detectMsgFormat(TEST_MARKDOWN)).toBe('interactive');
    });

    it('builds card elements from full test markdown', () => {
      const elements = channel._buildCardElements(TEST_MARKDOWN);

      // Should have multiple elements including tables, headings, code blocks
      expect(elements.length).toBeGreaterThan(0);

      // Should have table elements
      const tables = elements.filter((e: any) => e.tag === 'table');
      expect(tables.length).toBeGreaterThan(0);

      // Should have div elements for headings
      const divs = elements.filter((e: any) => e.tag === 'div');
      expect(divs.length).toBeGreaterThan(0);

      // Should have markdown elements for code blocks and other content
      const markdowns = elements.filter((e: any) => e.tag === 'markdown');
      expect(markdowns.length).toBeGreaterThan(0);

      // Should have hr elements
      const hrs = elements.filter((e: any) => e.tag === 'hr');
      expect(hrs.length).toBeGreaterThan(0);
    });

    it('splits elements by table limit correctly', () => {
      const elements = channel._buildCardElements(TEST_MARKDOWN);
      const groups = splitElementsByTableLimit(elements, 1);

      // Each group should have at most 1 table
      for (const group of groups) {
        const tableCount = group.filter((e: any) => e.tag === 'table').length;
        expect(tableCount).toBeLessThanOrEqual(1);
      }

      // All elements should be preserved across groups
      const allElements = groups.flat();
      expect(allElements.length).toBe(elements.length);
    });
  });
});
