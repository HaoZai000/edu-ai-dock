# AI 教务导入脚本规范化与上传流程

本文档用于处理这样一条链路：

1. 用户在 App 的「AI 教务导入」里生成并跑通一份教务脚本；
2. 脚本被上传到服务端脚本库；
3. 维护者拿到脚本文件，并确认学校、入口 URL 等信息；
4. 按本文档做规范化检查、修正，并提交到 `edu-ai-dock` 仓库。

目标不是重写脚本，而是**在保留已验证行为的前提下，修正桥契约、数据契约、明显 bug 和仓库格式问题**。

---

## 一、用户需要提供的最小信息

| 信息 | 说明 |
| --- | --- |
| 脚本文件 | 用户从 App 导出的 `.js` 原文件 |
| 学校全称 | 例如「西安邮电大学」 |
| 学校缩写 / ID | 用于仓库目录，例如 `XUPT`、`NUIT`、`FAFU` |
| 教务入口 URL | 登录页或教务首页，例如 `https://auth.xupt.edu.cn/esc-sso/login/page` |
| 是否仅校园网 | 影响卡片描述和用户预期 |
| 已知特殊情况 | SSO、iframe、GBK 编码、需要选学期、需要校区代码等 |

如果用户没有给缩写，按学校域名或英文名取一个稳定 ID；`initial` 取学校中文名首字母（福建 F、广东 G、湖南 H、西安 X）。

---

## 二、红线（先读）

- **不要重写已经验证成功的解析逻辑**。除非发现明确的契约错误或数据 bug，否则保留原逻辑，只做格式、桥调用、错误处理上的修正。
- **不要为了「更优雅」改变行为**。例如把已验证的 `jcor` 解析换成另一套正则、把推导作息换成猜测作息，都可能让原本能导入的学校失败。
- **不要手改 `index/school_index.json`**。它由 CI 自动生成，维护者只需要改 `index/root_index.yaml` 和 `resources/`。
- **不要提交任何 token、cookie、学号、姓名、真实课表数据**。脚本里只保留接口路径和字段映射。
- **不要给脚本加自动 `reload()`、自动重试、隐藏的 fallback 数据**；这些会掩盖真实问题。
- **先确认脚本是否在 App 里真实跑通，再决定改哪里**；不要凭猜测重写。

---

## 三、第一步：读脚本，定位结构

拿到脚本后先完整读一遍，标出以下部分：

1. 入口：是否 `(async () => { ... })()` 包裹，是否有顶层 `await`。
2. 接口：`BASE` / `location.origin`、页面 URL、课表接口、作息接口、配置接口。
3. 选择器：学年 / 学期 / 校区 / 学年学期代码从哪里来。
4. 解析：课程名、教师、地点、星期、节次、周次、单双周、连堂。
5. 合并：连续节次合并、同课同节次周次并集。
6. 保存：`saveImportedCourses`、`saveCourseConfig`、`savePresetTimeSlots`、`notifyTaskCompletion` 的调用顺序。
7. 错误处理：失败是否只 toast、是否会误报成功、是否会吞掉保存失败。

---

## 四、第二步：核对桥契约（最高优先级）

### 4.1 两个桥对象

| 对象 | 类型 | 用途 |
| --- | --- | --- |
| `window.shiguangBridgePromise` | 对象，方法返回 Promise | `showAlert`、`showSingleSelection`、`saveImportedCourses`、`saveCourseConfig`、`savePresetTimeSlots`、`saveComboSchedule` |
| `window.shiguangBridge` | 同步桥 | `showToast`、`notifyTaskCompletion`；以及底层原始 `@JavascriptInterface` 方法 |

注意：`shiguangBridgePromise` 不是 Promise 本身，而是「方法返回 Promise 的对象」，可以直接 `bp.saveImportedCourses(...)`。

### 4.2 真实签名

```js
showAlert(title, content, confirmText)                 // Promise<boolean>
showSingleSelection(title, itemsJsonString, defaultIndex) // Promise<number | null>
saveImportedCourses(coursesJsonString)                 // Promise<true>
saveCourseConfig(configJsonString)                     // Promise<true>
savePresetTimeSlots(timeSlotsJsonString)               // Promise<true>
saveComboSchedule(comboJsonString)                     // Promise<true>
showToast(message)                                     // 同步
notifyTaskCompletion()                                 // 同步
```

关键点：

- `showSingleSelection` 第二个参数必须是 **JSON 字符串数组**，不是对象。
- `showSingleSelection` 取消时返回 `null` 或 `-1`，都必须中止导入。
- `saveImportedCourses` 成功时返回 `true`，**不是课程数**；课程数用脚本自己的数组长度。
- `showAlert` 取消返回 `false`。
- 不要在 AI 脚本里使用 `showPrompt`。

### 4.3 最常见的桥错误

1. 把 `showAlert` / `showSingleSelection` 调到同步桥 `shiguangBridge` 上。
   - 同步桥上是底层原始方法，参数需要 `promiseId`，不是 3 参数版本。
   - 正确做法：优先 `shiguangBridgePromise.showAlert(...)`。
2. 通用 `bridgeCall` 先试同步桥，抛错后直接 `return null`，永远到不了 Promise 桥。
   - 正确顺序：Promise 桥优先；同一座桥失败后不要误用另一座桥的原始方法。
3. 把 `saveImportedCourses` 的返回值当课程数。
4. 不检查保存结果，课程保存失败仍然 toast「导入成功」。
5. 脚本写顶层 `await`。真实桥直接注入脚本，顶层 `await` 会语法错误；必须包在 async IIFE 里。

### 4.4 推荐写法

```js
(async () => {
  const bp = window.shiguangBridgePromise || {};
  const bridge = window.shiguangBridge || {};

  const idx = await bp.showSingleSelection(title, JSON.stringify(labels), def);
  if (idx === null || idx === -1) return;

  const ok = await bp.showAlert('确认导入', content, '开始导入');
  if (ok === false) return;

  const saved = await bp.saveImportedCourses(JSON.stringify(courses));
  if (saved === null || saved === false) throw new Error('课程保存失败');

  if (slots.length) await bp.savePresetTimeSlots(JSON.stringify(slots));
  bridge.showToast('已导入 ' + courses.length + ' 门课');
  bridge.notifyTaskCompletion();
})();
```

---

## 五、第三步：核对数据契约

### 5.1 课程字段

```js
{
  name: '高等数学',
  teacher: '张三',
  position: '教105',
  day: 1,                 // 1=周一 ... 7=周日
  startSection: 1,
  endSection: 2,
  weeks: [1, 2, 3, 4]     // 展开后的整数数组，1~30
}
```

- `name` 必须非空。
- `day` 必须是 1~7。
- `weeks` 必须是非空整数数组，不能是 `"1-8周"` 字符串。
- 有真实起止时间但无节次时：

```js
{
  name: '体育',
  isCustomTime: true,
  customStartTime: '08:00',
  customEndTime: '09:35',
  day: 3,
  weeks: [1, 2, 3]
}
```

- 单双周、跳周、分散周次都按实际展开。
- 同名但教师/地点/节次不同的课必须分开。
- 同一门课同周次且节次连续（1-2 + 3-4）合并成 1-4。
- 同一门课同节次时，`weeks` 取并集。

### 5.2 保存顺序与空值

顺序：

```
课程 → 配置 → 作息（→ 组合）→ notifyTaskCompletion
```

- 课程为空：不要调用 `saveImportedCourses`，直接报错。
- 配置拿不到：不要调用 `saveCourseConfig`，不要传 `{}`。
- 作息拿不到：不要调用 `savePresetTimeSlots`，不要传 `[]`。
- 只写真正拿到的配置字段，不要用猜测值填空。

### 5.3 校验位置

AI 沙箱和预览页都会按同样规则校验课程；如果脚本提交的课程全部无效，AI 会收到 `invalidReasons`（字段级原因 + 实际 keys）。规范化时优先看这类反馈：

- `不是对象` → 数组多包了一层，或元素是字符串；
- `缺 name` → 课程名没取到；
- `day 不是 1-7` → 字段名不对或值为 0；
- `weeks 不是数组` / `weeks 里没有 1-30 的整数` → 周次没展开；
- `缺节次或时间` → `startSection/endSection` 为 undefined 或字段名写错。

---

## 六、第四步：核对学校特有逻辑

- **接口地址**：一律基于 `location.origin` 拼接，不写死域名。
- **SSO / iframe**：确认脚本运行时的 `location.origin` 是教务接口所在域，不是统一认证域；跨域时不要直接用 `fetch`，先确认同源。
- **GBK / GB2312**：ASP.NET 页面需要按 `charset` 解码；优先 `TextDecoder('gbk')`。
- **`__VIEWSTATE` / `__EVENTVALIDATION`**：不要复制长值；脚本运行时从 `document` 读取，或 `new FormData(form)`。
- **切换学年 / 学期**：POST 回来后检查下拉框 `selected` 是否变成目标值；没变就报错，不要拿旧 HTML 继续导入。
- **选择器**：学年、学期、校区代码从页面 option 或接口返回里取；不要让用户抄代码，也不要写死。
- **节次映射**：学校若有午休占位节次（如 5、6），保留原有的映射逻辑，不要自行重排。
- **作息**：优先用接口返回；没有接口时再按学校的大节时间推导；不要编造。
- **校区**：需要校区代码的学校，先查 `getMyScheduledCampus` 之类的接口，再拉课表。

---

## 七、第五步：规范化与清理

- 包进 `(async () => { ... })()`，不污染页面全局。
- 不用 `import`，不写顶层 `await`。
- 统一用 `const` / `let`，去掉 `var`（保留学校逻辑不变）。
- 删除：调试脚本、诊断课程、`console.log`、未使用的请求、注释掉的代码、真实姓名/学号/token。
- 保留：学校特有的节次映射、周次位图、教师 HTML 解析、地点清洗、两段式合并。
- 修正错误处理：保存失败要抛错或明确 toast「失败」，不能静默成功。
- 取消选择、取消确认都要 toast「已取消导入」。
- 注释用中文，简短说明「为什么」，不复述代码。

---

## 八、第六步：入库

仓库：`edu-ai-dock`（GitHub / Gitee 同名仓库）。以下命令都在仓库根目录执行。

### 8.1 目录结构

```
resources/{ID}/
  adapters.yaml
  {id}.js
index/root_index.yaml
index/school_index.json   # CI 自动生成，不要手动修改 / 提交
```

### 8.2 `adapters.yaml` 模板

```yaml
# resources/{ID}/adapters.yaml
# {学校全称}（{入口域名}，仅校园网可访问 / 无限制）

adapters:
  - adapter_id: "{ID}_01"
    adapter_name: "{学校全称}{ID}"
    category: "BACHELOR_AND_ASSOCIATE"
    asset_js_path: "{id}.js"
    import_url: "{登录入口 URL}"
    maintainer: "Nexio课程表"
    description: "教务系统课表适配。登录教务系统后直接点导入即可，不需要手动进入课表页；脚本会自动读取学期、校区、整学期课表与作息。{仅校园网可访问时在这里补一句}"
```

约定：

- `maintainer` 统一写 `Nexio课程表`（实际收录的学校适配器）。
- `import_url` 是登录入口，不是课表接口。
- 仅校园网可访问的学校必须在 `description` 里写明。
- 不需要手动进入课表页的，也要在 `description` 里写明。

### 8.3 登记学校

在 `index/root_index.yaml` 的 `schools` 里按 `initial` 顺序插入：

```yaml
  - id: "{ID}"
    name: "{学校全称}"
    initial: "{首字母}"
```

### 8.4 索引由 CI 生成

只需要提交 `index/root_index.yaml` 和 `resources/{ID}/`；不要手动生成或提交
`index/school_index.json`，CI 会在合并后自动重建。

---

## 九、第七步：验证

```bash
# 1. 语法
node --check resources/{ID}/{id}.js

# 2. 桥调用审阅
grep -nE "showAlert|showSingleSelection|saveImportedCourses|savePresetTimeSlots|saveCourseConfig|notifyTaskCompletion" resources/{ID}/{id}.js

# 3. 检查是否写死域名 / 敏感信息
grep -nE "https?://|token|password|cookie|学号|姓名" resources/{ID}/{id}.js
```

有条件时在 App 里用真实账号试跑一次，确认能正常走到预览。

---

## 十、第八步：提交与推送

```bash
git add index/root_index.yaml resources/{ID}
git commit -m "feat: 新增{学校全称} {ID} 教务适配（Nexio课程表）"

git pull --rebase origin main
git push origin main
```

CI 会自动重建 `index/school_index.json`；如果 CI 失败，按 CI 日志检查 YAML / 路径，
不要手动提交生成的索引。

---

## 十一、第九步：回复模板

```text
已规范化并上传。

## 仓库改动
commit {hash}：
- resources/{ID}/{id}.js
- resources/{ID}/adapters.yaml
- index/root_index.yaml 登记 {ID} / {学校} / {initial}

卡片信息：{adapter_name}，{category}，维护者 Nexio课程表，入口 {import_url}。

## 规范化内容
1. 桥调用顺序 / 签名修正
2. 保存结果检查
3. 取消处理
4. 清理无用请求 / 调试代码
5. 保留学校特有解析逻辑

## 验证
node --check 通过；CI 通过后索引会自动更新。

## 注意事项
{仅校园网 / 需要选学期 / 入口 URL 可能随学校调整}
```

---

## 十二、常见失败模式

| 现象 | 优先排查 |
| --- | --- |
| `usableCount=0` / 全部课程无效 | 看 `invalidReasons`：null、嵌套数组、`weeks` 是字符串、字段名写成 `sectionStart`、`day=0` |
| 脚本一直没有结果 | 死循环（全局正则零长度匹配）、fetch 永远不 resolve；90 秒超时；不要盲目加自动 reload |
| `saveImportedCourses` 返回 `true` 却被当课程数 | 改成用脚本自己的 `courses.length` |
| `showAlert` 参数不生效 / 直接跳过 | 调到了同步桥；改用 `shiguangBridgePromise.showAlert` |
| 用户取消后仍然导入 | `showSingleSelection` 返回 `null` / `-1` 没中止 |
| 切换学期后导入的是旧学期 | POST 后没检查 `selected`，或失败后回退旧 HTML |
| 中文乱码 | 没按 `charset` 解码；ASP.NET 常见 GBK |
| POST 切换学期后仍是旧数据 | 检查 POST 参数 / 事件目标；校验下拉框 `selected`，禁止回退旧 HTML |
| 校园网学校在流量下失败 | 卡片描述要写明仅校园网 / 需要 VPN |

---

## 十三、快速检查清单

- [ ] 脚本包在 async IIFE 里，无顶层 `await`、无 `import`
- [ ] `showAlert` / `showSingleSelection` 走 `shiguangBridgePromise`
- [ ] 选择器第二参数是 `JSON.stringify(数组)`
- [ ] 取消返回 `null` / `-1` 会中止
- [ ] `saveImportedCourses` 返回值按 `true` 处理，并检查失败
- [ ] 课程字段完整，`weeks` 是展开的整数数组
- [ ] 连堂合并、周次并集正确
- [ ] 保存顺序：课程 → 配置 → 作息 → notify
- [ ] 缺数据时整段跳过，不传空对象 / 空数组
- [ ] 接口基于 `location.origin`，无写死域名
- [ ] 无 token / cookie / 学号 / 姓名 / 真实课表数据
- [ ] `node --check` 通过
- [ ] `root_index.yaml` 已登记；没有手动提交 `school_index.json`
- [ ] 提交信息与维护者符合仓库约定

---

## 十四、维护者参考（App 侧）

- 工具 schema 与系统提示词：`ui-shared/src/commonMain/kotlin/com/haooz/chedule/ui/ai/EduAgentPrompts.kt`
- 5 个工具与脚本沙箱：`ui-shared/src/commonMain/kotlin/com/haooz/chedule/ui/ai/EduAgentTools.kt`
- Agent 主循环、作息 gate、工具结果回执：`ui-shared/src/commonMain/kotlin/com/haooz/chedule/ui/ai/EduAgentSession.kt`
- 桥注入：`ui-shared/src/commonMain/kotlin/com/haooz/chedule/ui/web/JsPromiseBridge.kt`
- Android 原生桥：`androidApp/src/main/java/com/haooz/chedule/ui/web/AndroidBridge.kt`
- 导入桥核心（保存 / 解析 / 应用）：`ui-shared/src/commonMain/kotlin/com/haooz/chedule/ui/web/EduImportBridgeCore.kt`
- 适配器仓库：`edu-ai-dock`

---

## 十五、以后怎么调用本文档

提供脚本文件，并补充：

- 学校全称 / 缩写
- 教务入口 URL
- 是否仅校园网
- 已知特殊情况（SSO、GBK、需要选学期等）

然后说明「按本文档处理」即可，从「读脚本」到「提交推送」逐步执行。
