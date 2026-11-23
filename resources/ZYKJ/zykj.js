// 中原科技学院 教务系统（eams / beangle）整学期课表适配器
// 数据源：GET  /eams/courseTableForStd.action            -> 学生 ids、学期列表、教学周数
//        POST /eams/dataQuery.action                    -> 学年学期列表（semesterCalendar）
//        POST /eams/courseTableForStd!courseTable.action -> 整学期课表脚本（TaskActivity）
(async function main() {
  const BASE = location.origin;
  const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BD = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  function ui(name) {
    if (BP && typeof BP[name] === 'function') return BP[name].bind(BP);
    if (BD && typeof BD[name] === 'function') return BD[name].bind(BD);
    return null;
  }

  function toast(msg) {
    const f = ui('showToast');
    if (f) { try { f(msg); } catch (e) {} }
  }

  async function alert(title, content, confirmText) {
    const f = ui('showAlert');
    if (!f) return true;
    return (await f(title, content, confirmText || '确定')) !== false;
  }

  async function select(title, labels, def) {
    const f = ui('showSingleSelection');
    if (!f) throw new Error('桥未就绪，请重试');
    return await f(title, JSON.stringify(labels), def);
  }

  async function httpText(path, opts) {
    const r = await fetch(BASE + path, Object.assign({ credentials: 'include' }, opts || {}));
    if (!r.ok) throw new Error('请求失败 HTTP ' + r.status + ' ' + path);
    return await r.text();
  }

  // ---------- 1. 学年学期 / 学生 ids / 教学周数 ----------
  async function fetchAcademicOptions() {
    const page = await httpText('/eams/courseTableForStd.action');
    const idsM = page.match(/addInput\(form,\s*"ids",\s*"(\d+)"\)/);
    const ids = idsM ? idsM[1] : '';
    const barM = page.match(/id="(semesterBar\w*?Semester)"/);
    const tagId = barM ? barM[1] : 'semesterBarSemester';
    const curM = page.match(/semesterCalendar\(\{empty:"[^"]*",onChange:"[^"]*",value:"(\d*)"/) ||
      page.match(/value:"(\d+)"/);
    let curSemester = curM ? curM[1] : '';

    let totalWeeks = 0;
    const swM = page.match(/<select id="startWeek"[\s\S]*?<\/select>/);
    if (swM) {
      const nums = Array.from(swM[0].matchAll(/<option value="(\d+)"/g)).map((m) => parseInt(m[1], 10));
      if (nums.length) totalWeeks = Math.max.apply(null, nums);
    }

    const semesters = [];
    try {
      const body = 'tagId=' + encodeURIComponent(tagId) +
        '&dataType=semesterCalendar&value=' + encodeURIComponent(curSemester) + '&empty=false';
      const txt = await httpText('/eams/dataQuery.action', { method: 'POST', headers: FORM_HEADERS, body: body });
      for (const m of txt.matchAll(/\{id:(\d+),schoolYear:"([^"]*)",name:"([^"]*)"\}/g)) {
        semesters.push({ id: m[1], label: m[2] + ' 第' + m[3] + '学期' });
      }
      if (!curSemester) {
        const cm = txt.match(/semesterId:"(\d+)"/);
        if (cm) curSemester = cm[1];
      }
    } catch (e) {}

    return { ids: ids, curSemester: curSemester, totalWeeks: totalWeeks, semesters: semesters };
  }

  async function chooseSemester(opts) {
    if (!opts.semesters.length) {
      if (!opts.curSemester) return null;
      return { id: opts.curSemester, label: '当前学期' };
    }
    // 只有一个学期时直接使用，避免多余的选择交互
    if (opts.semesters.length === 1) return opts.semesters[0];
    const labels = opts.semesters.map((s) => s.label);
    let def = opts.semesters.findIndex((s) => String(s.id) === String(opts.curSemester));
    if (def < 0) def = labels.length - 1;
    const pick = await select('选择要导入的学年学期', labels, def);
    if (pick === null || pick === undefined) return null;
    const s = String(pick).trim();
    if (s === '-1' || s === '') return null;
    if (/^\d+$/.test(s)) {
      const i = parseInt(s, 10);
      if (i >= 0 && i < opts.semesters.length) return opts.semesters[i];
    }
    const byLabel = opts.semesters.findIndex((x) => x.label === s);
    if (byLabel >= 0) return opts.semesters[byLabel];
    return null;
  }

  // ---------- 2. 拉取整学期课表 ----------
  async function fetchCourseTable(ids, semesterId) {
    const body = 'ignoreHead=1&setting.kind=std&startWeek=&semester.id=' + encodeURIComponent(semesterId) +
      '&ids=' + encodeURIComponent(ids || '');
    const html = await httpText('/eams/courseTableForStd!courseTable.action', {
      method: 'POST', headers: FORM_HEADERS, body: body
    });
    const usedM = html.match(/semester\.id=(\d+)/);
    if (usedM && String(usedM[1]) !== String(semesterId)) {
      throw new Error('切换学期失败：返回的是 semester.id=' + usedM[1]);
    }
    return html;
  }

  // ---------- 3. 解析 TaskActivity 脚本 ----------
  function splitActivityArgs(src) {
    const args = [];
    let cur = '';
    let q = null;
    let depth = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (q) {
        cur += c;
        if (c === q && src[i - 1] !== '\\') q = null;
        continue;
      }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
      if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--; cur += c; continue;
      }
      if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim() !== '') args.push(cur.trim());
    return args;
  }

  function unquote(v) {
    const s = (v || '').trim();
    if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1);
    return s;
  }

  function parseCourseTable(html) {
    const unitM = html.match(/var\s+unitCount\s*=\s*(\d+)/);
    const unitCount = unitM ? parseInt(unitM[1], 10) : 10;
    const mtM = html.match(/\.marshalTable\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    const from = mtM ? parseInt(mtM[1], 10) : 1;
    const lastWeek = mtM ? parseInt(mtM[3], 10) : 30;

    const nameMarks = Array.from(html.matchAll(/name:"([^"]*)"/g)).map((m) => ({ pos: m.index, name: m[1] }));

    const starts = [];
    const marker = /activity\s*=\s*new\s+TaskActivity\(/g;
    let mm;
    while ((mm = marker.exec(html)) !== null) {
      starts.push({ markerStart: mm.index, argStart: mm.index + mm[0].length });
    }

    const raw = [];
    for (let i = 0; i < starts.length; i++) {
      const segEnd = i + 1 < starts.length ? starts[i + 1].markerStart : html.length;
      const seg = html.slice(starts[i].argStart, segEnd);
      const args = splitActivityArgs(seg);
      if (args.length < 7) continue;

      const courseName = unquote(args[3]);
      const roomName = unquote(args[5]);
      const validWeeks = unquote(args[6]);

      let teacher = /^["']/.test(args[1]) ? unquote(args[1]) : '';
      if (!teacher) {
        for (let k = nameMarks.length - 1; k >= 0; k--) {
          if (nameMarks[k].pos < starts[i].markerStart) { teacher = nameMarks[k].name; break; }
        }
      }

      const weeks = [];
      for (let p = 0; p < validWeeks.length; p++) {
        if (validWeeks[p] === '1') {
          const w = p - from + 2;
          if (w >= 1 && w <= lastWeek && w <= 30) weeks.push(w);
        }
      }
      if (!courseName || !weeks.length) continue;

      const cells = Array.from(seg.matchAll(/index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)/g))
        .map((m) => ({ day: parseInt(m[1], 10) + 1, unit: parseInt(m[2], 10) + 1 }));
      if (!cells.length) continue;

      const byDay = new Map();
      for (const c of cells) {
        if (!byDay.has(c.day)) byDay.set(c.day, []);
        byDay.get(c.day).push(c.unit);
      }
      for (const entry of byDay) {
        const day = entry[0];
        const units = entry[1].slice().sort((a, b) => a - b);
        let s = units[0];
        let prev = units[0];
        for (let k = 1; k <= units.length; k++) {
          const u = units[k];
          if (u !== undefined && u === prev + 1) { prev = u; continue; }
          raw.push({
            name: courseName, teacher: teacher, position: roomName, day: day,
            startSection: s, endSection: prev, weeks: weeks.slice()
          });
          s = u; prev = u;
        }
      }
    }
    return raw;
  }

  // ---------- 4. 校验 + 两阶段合并 ----------
  function mergeBlocks(blocks) {
    const list = blocks.slice().sort((a, b) => a.start - b.start);
    const out = [];
    for (const b of list) {
      const last = out[out.length - 1];
      if (last && b.start <= last.end + 1) last.end = Math.max(last.end, b.end);
      else out.push({ start: b.start, end: b.end });
    }
    return out;
  }

  function normalizeCourses(raw) {
    let skipped = 0;
    const valid = [];
    for (const r of raw) {
      if (!r.name) { skipped++; continue; }
      if (!(r.day >= 1 && r.day <= 7)) { skipped++; continue; }
      if (!(r.startSection >= 1 && r.endSection >= r.startSection)) { skipped++; continue; }
      if (!r.weeks || !r.weeks.length) { skipped++; continue; }
      valid.push(r);
    }

    // 阶段一：同课同周次且节次连续 -> 合并节次
    const mapA = new Map();
    for (const r of valid) {
      const k = [r.name, r.teacher, r.position, r.day, r.weeks.join(',')].join('|');
      if (!mapA.has(k)) {
        mapA.set(k, {
          name: r.name, teacher: r.teacher, position: r.position, day: r.day,
          weeks: r.weeks, blocks: [{ start: r.startSection, end: r.endSection }]
        });
      } else {
        mapA.get(k).blocks.push({ start: r.startSection, end: r.endSection });
      }
    }

    const perBlock = [];
    for (const v of mapA.values()) {
      const weeks = Array.from(new Set(v.weeks)).sort((a, b) => a - b);
      for (const b of mergeBlocks(v.blocks)) {
        perBlock.push({
          name: v.name, teacher: v.teacher, position: v.position, day: v.day,
          startSection: b.start, endSection: b.end, weeks: weeks
        });
      }
    }

    // 阶段二：同课同节次 -> 周次取并集
    const mapB = new Map();
    for (const r of perBlock) {
      const k = [r.name, r.teacher, r.position, r.day, r.startSection, r.endSection].join('|');
      if (!mapB.has(k)) {
        mapB.set(k, {
          name: r.name, teacher: r.teacher, position: r.position, day: r.day,
          startSection: r.startSection, endSection: r.endSection, weeks: new Set(r.weeks)
        });
      } else {
        r.weeks.forEach((w) => mapB.get(k).weeks.add(w));
      }
    }

    const courses = [];
    for (const v of mapB.values()) {
      courses.push({
        name: v.name,
        position: v.position,
        teacher: v.teacher,
        day: v.day,
        startSection: v.startSection,
        endSection: v.endSection,
        weeks: Array.from(v.weeks).sort((a, b) => a - b)
      });
    }
    courses.sort((a, b) => (a.day - b.day) || (a.startSection - b.startSection) || a.name.localeCompare(b.name));
    return { courses: courses, skipped: skipped };
  }

  // ---------- 5. 主流程 ----------
  async function runImportFlow() {
    const opts = await fetchAcademicOptions();
    const sem = await chooseSemester(opts);
    if (!sem) { toast('已取消，未导入'); return; }

    const html = await fetchCourseTable(opts.ids, sem.id);
    const parsed = normalizeCourses(parseCourseTable(html));
    const courses = parsed.courses;
    if (!courses.length) throw new Error('该学期未解析到任何课程，请确认课表是否存在');

    let tip = '学期：' + sem.label + '\n课程：' + courses.length + ' 条';
    if (parsed.skipped) tip += '（另有 ' + parsed.skipped + ' 条无效记录已跳过）';
    if (opts.totalWeeks && String(sem.id) === String(opts.curSemester)) tip += '\n教学周：' + opts.totalWeeks + ' 周';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    if (opts.totalWeeks && String(sem.id) === String(opts.curSemester)) {
      // 只写接口返回的真实总周数，不猜开学日期与星期基准
      try {
        await BP.saveCourseConfig(JSON.stringify({ semesterTotalWeeks: opts.totalWeeks }));
      } catch (e) {
        configFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + courses.length + ' 条课程安排' +
      (parsed.skipped ? '，跳过 ' + parsed.skipped + ' 条无效记录' : '') +
      (configFailed ? '（教学周未保存）' : ''));
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
