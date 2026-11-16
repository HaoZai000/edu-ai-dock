# edu-ai-dock

AI 教务导入生成的适配脚本仓库。客户端（NexioSchedule / 时光）会把本仓库与拾光仓库
（`shiguang_warehouse`）**一起拉取、合并展示**，AI 来源的适配器卡片叠一层淡蓝色底作区分。

- GitHub（主仓）：`https://github.com/HaoZai000/edu-ai-dock`
- Gitee（镜像）：`https://gitee.com/com_haooz_account/edu-ai-dock`

## 结构（与拾光一致）

和拾光一样：根索引登记学校，每所学校一个 `adapters.yaml` 写多个适配器，脚本与它同级。
拾光用 CI 把 YAML 编成 pb，这里用 CI 把它编成 JSON，客户端只读编好的那一份：

| 拾光仓库 | 本仓库 |
| --- | --- |
| `index/root_index.yaml` | `index/root_index.yaml` |
| `resources/{学校}/adapters.yaml` | `resources/{学校}/adapters.yaml` |
| `resources/{学校}/{脚本}.js` | `resources/{学校}/{脚本}.js` |
| CI → `school_index.pb` | CI → `index/school_index.json` |

```
.
├─ index/
│  ├─ root_index.yaml        # 学校列表，手改
│  └─ school_index.json      # CI 生成，不要手改
├─ resources/
│  ├─ _template/             # 新增学校时整份复制改名
│  │  ├─ adapters.yaml
│  │  └─ adapter-template.js
│  └─ DEMO/                  # 目录名 = root_index 里的 id
│     ├─ adapters.yaml       # 示例适配器（验证链路用，正式发版删掉）
│     └─ demo.js
├─ scripts/build_index.py    # CI 用的构建脚本
└─ .github/workflows/build-index.yml
```

没有 `schema/` 目录：字段校验直接在构建脚本里做，缺字段、分类写错、脚本文件不存在都会让 CI 失败并指出是哪一条。

## 新增学校

1. 复制 `resources/_template` → `resources/{学校缩写}`；
2. 改 `adapters.yaml`，放脚本文件；
3. 在 `index/root_index.yaml` 的 `schools` 里加一条：

```yaml
schools:
  - id: "CUG"
    name: "中国地质大学（武汉）"
    initial: "C"
```

然后推上去，CI 自动重建 `index/school_index.json`。`id` 尽量与拾光仓库同校一致；
不同时客户端按 `name` 兜底合并，连名字都不同就会变成两所学校。

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

- 数组里**几项就是几个适配器**，`adapter_id` 校内唯一（建议 `学校ID_序号`），发布后不复用。
- `category` 与拾光一致：`BACHELOR_AND_ASSOCIATE`（本科/专科）、`POSTGRADUATE`（研究生）、`GENERAL_TOOL`（通用工具）。
- `asset_js_path` 只写**同目录下的文件名**，每个适配器一个脚本；新增同校第二个适配器时追加一项 + 放一个脚本，不要替换原有条目。
- 与拾光同校同 `adapter_id` 时，客户端按 `(来源, adapter_id)` 去重且**拾光优先**；AI 版本要并存请换一个 id。

## 适配器说明（用户端展示的那一节）

底部弹窗里每个适配器卡片展示的内容，全部来自 `adapters.yaml`，字段与拾光一一对应：

| 卡片上展示 | 字段 | 说明 |
| --- | --- | --- |
| 标题 | `adapter_name` | 必填 |
| 右上角分类 | `category` | 必填，字符串枚举 |
| 正文说明 | `description` | 必填，直接展示 |
| 维护者 | `maintainer` | 必填，展示为「维护者：xxx」 |
| 通用工具入口 | `import_url` | 通用工具类使用 |
| 卡片底色 | — | AI 仓库来源自动叠淡蓝色，不需要填 |

## 脚本约定

脚本在教务页面里执行，通过 `window.shiguangBridgePromise` 回写数据（与拾光仓库一致）：

```js
const N = await shiguangBridgePromise.saveCourseConfig(JSON.stringify({ /* 节次配置 */ }));
const T = await shiguangBridgePromise.savePresetTimeSlots(JSON.stringify([ /* 作息 */ ]));
const C = await shiguangBridgePromise.saveImportedCourses(JSON.stringify([ /* 课程 */ ]));
```

要求：

1. 不写顶层 `await`（会被包进 async 函数执行）。
2. 课程必须带真实的上课星期、节次与周次；拿不到就抛错，不要猜默认值。
3. 不发起与本校教务无关的请求，不读取与课表无关的页面内容。
4. 脚本里不要出现 token、学号等个人凭据。

## 免责声明

脚本为社区/AI 生成，未经与任何学校官方确认；请仅在自己的账号下使用，风险自负。
