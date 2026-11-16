# edu-ai-dock

教务系统适配脚本仓库，由 AI 生成、人工维护，**Nexio 课程表**与 **SleepDown 课程表**共用同一份索引与脚本。
两个客户端读取同一份 `index/school_index.json`，在教务导入页里展示同一批学校与适配器，
点开适配器时才按需下载对应脚本。

- GitHub：`https://github.com/HaoZai000/edu-ai-dock`
- Gitee（镜像）：`https://gitee.com/com_haooz_account/edu-ai-dock`

## 结构

索引由 CI 从 YAML 生成，客户端只读生成好的 JSON，编辑时只改 YAML：

```
.
├─ index/
│  ├─ root_index.yaml        # 学校列表，手改
│  └─ school_index.json      # CI 生成，不要手改
├─ resources/
│  ├─ _template/             # 新增学校时整份复制改名
│  │  ├─ adapters.yaml
│  │  └─ adapter-template.js
│  └─ CUG/                   # 目录名 = root_index 里的 id
│     ├─ adapters.yaml       # 这所学校的适配器说明（可以有多个）
│     ├─ cug.js
│     └─ cug_postgraduate.js
├─ scripts/build_index.py    # CI 调用的构建脚本
└─ .github/workflows/build-index.yml
```

- `index/root_index.yaml`：学校列表，字段 `id` / `name` / `initial`。
- `resources/{id}/adapters.yaml`：这所学校的全部适配器，数组里写几条就有几个适配器。
- `resources/{id}/{脚本}.js`：脚本与 `adapters.yaml` 同级，`asset_js_path` 只写文件名。
- 推送后 CI 自动把 YAML 编成 `index/school_index.json`，内容没变化时不会产生提交。

构建脚本会校验：学校 id 与适配器 id 唯一、`category` 合法、`asset_js_path` 是同目录 `.js` 文件且真实存在。
任何一项不合法都会让 CI 失败，并指出是哪所学校、哪个适配器的哪个字段。

## 新增学校

1. 复制 `resources/_template` → `resources/{学校缩写}`；
2. 改 `adapters.yaml`，放脚本文件；
3. 在 `index/root_index.yaml` 的 `schools` 里登记一行：

```yaml
schools:
  - id: "CUG"
    name: "中国地质大学（武汉）"
    initial: "C"
```

4. 推送，等 CI 重建 `index/school_index.json`。

`id` 全局唯一，同时作为目录名，建议用学校缩写；`initial` 是单个大写字母，用于列表分组。
如果同一所学校要同时提供给两个客户端，只维护这一份，不要在客户端里写死。

## 一个学校多个适配器

`resources/CUG/adapters.yaml`：

```yaml
adapters:
  - adapter_id: "CUG_01"
    adapter_name: "中国地质大学（武汉）正方教务"
    category: "BACHELOR_AND_ASSOCIATE"
    asset_js_path: "cug.js"
    import_url: "https://sfrz.cug.edu.cn/authserver/login"
    maintainer: "kncatl"
    description: "正方教务系统 API 适配。登录任意页面一键导入，支持南望山与未来城校区作息。"

  - adapter_id: "CUG_02"
    adapter_name: "中国地质大学（武汉）研究生教务"
    category: "POSTGRADUATE"
    asset_js_path: "cug_postgraduate.js"
    import_url: "https://epo.cug.edu.cn"
    maintainer: "JiaLiFuNia"
    description: "研究生教务管理系统。登录并定位到学期课表页面后点击导入。"
```

规则：

- 数组里有几项就是几个适配器，`adapter_id` 校内唯一（建议 `学校ID_序号`），发布后不复用。
- `category`：`BACHELOR_AND_ASSOCIATE`（本科/专科）、`POSTGRADUATE`（研究生）、`GENERAL_TOOL`（通用工具）。
- 每个适配器一个脚本文件，与 `adapters.yaml` 同级；文件名不要求和 `adapter_id` 相同。
- 新增同校第二个适配器：往 `adapters` 数组**追加**一项 + 放一个脚本，不要替换原有条目。
- 两个客户端的导入页都支持同一所学校下显示多个适配器，选择后各自打开对应的 `import_url` 并注入对应脚本。

## 适配器说明（用户端展示的那一节）

两个客户端展示的适配器卡片内容，全部来自 `adapters.yaml`：

| 卡片上展示 | 字段 | 说明 |
| --- | --- | --- |
| 标题 | `adapter_name` | 必填 |
| 右上角分类 | `category` | 必填，字符串枚举 |
| 正文说明 | `description` | 必填，直接展示 |
| 维护者 | `maintainer` | 必填，展示为「维护者：xxx」 |
| 打开入口 | `import_url` | 点开适配器时网页加载的地址 |
| 卡片底色 | — | 由客户端决定，不需要填 |

## 生成的索引

`index/school_index.json` 结构固定，供客户端直接解析：

```json
{
  "protocol_version": 1,
  "version_id": "2026-11-16T08:52:15Z",
  "schools": [
    {
      "id": "CUG",
      "name": "中国地质大学（武汉）",
      "initial": "C",
      "adapters": [
        {
          "adapter_id": "CUG_01",
          "adapter_name": "中国地质大学（武汉）正方教务",
          "category": 2,
          "asset_js_path": "resources/CUG/cug.js",
          "import_url": "https://sfrz.cug.edu.cn/authserver/login",
          "description": "正方教务系统 API 适配。登录任意页面一键导入，支持南望山与未来城校区作息。",
          "maintainer": "kncatl"
        },
        {
          "adapter_id": "CUG_02",
          "adapter_name": "中国地质大学（武汉）研究生教务",
          "category": 3,
          "asset_js_path": "resources/CUG/cug_postgraduate.js",
          "import_url": "https://epo.cug.edu.cn",
          "description": "研究生教务管理系统。登录并定位到学期课表页面后点击导入。",
          "maintainer": "JiaLiFuNia"
        }
      ]
    }
  ]
}
```

- `category` 在构建时转成数字：`1` 通用工具、`2` 本科/专科、`3` 研究生。
- `asset_js_path` 由构建脚本补成仓库内完整路径，客户端直接按它下载。
- `protocol_version` 是索引协议版本（当前 `1`），客户端遇到更高版本会忽略该索引。
- `version_id` 由 CI 写入生成时间，仅用于排查。

## 脚本约定

脚本在教务页面里执行，通过导入桥回写数据。两个客户端提供同一套桥：

```js
// 异步方法返回 Promise
const C = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
```

可用的桥方法：

| 方法 | 作用 |
| --- | --- |
| `saveImportedCourses(json)` | 写入课程数组（必需） |
| `saveCourseConfig(json)` | 写入作息/学期配置（可选） |
| `savePresetTimeSlots(json)` | 写入时间段（可选） |
| `notifyTaskCompletion()` | 告知客户端流程结束 |

课程对象的字段：

```json
{
  "name": "高等数学",
  "teacher": "张三",
  "position": "教学楼 A101",
  "day": 1,
  "startSection": 1,
  "endSection": 2,
  "weeks": [1, 2, 3, 4, 5, 6, 7, 8]
}
```

要求：

1. 不写顶层 `await`（脚本会被包进 async 函数执行）。
2. `day` 必须在 1..7、`weeks` 必须非空、`startSection` 从 1 开始；拿不到就抛错，不要猜默认值。
3. 不发起与本校教务无关的请求，不读取与课表无关的页面内容。
4. 脚本里不要出现 token、学号等个人凭据。

## 本地校验

改完 YAML 可以先本地跑一遍构建，确认字段和脚本文件都没问题：

```bash
pip install pyyaml
python scripts/build_index.py
```

## 免责声明

脚本为社区/AI 生成，未经与任何学校官方确认；请仅在自己的账号下使用，风险自负。
