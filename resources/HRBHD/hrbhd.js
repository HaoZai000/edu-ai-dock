// 哈尔滨华德学院（112.102.214.203:8108，正方 jwglxt）整学期课表适配器
(async function main() {
  const ORIGIN = location.origin;
  const KB_INDEX = '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151';
  const KB_DATA = '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const KB_JC = '/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

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

  async function postForm(path, body) {
    const res = await fetch(ORIGIN + path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    });
    if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (e) { throw new Error(path + ' 返回非 JSON（可能登录失效）'); }
  }

  async function getHtml(path) {
    const res = await fetch(ORIGIN + path, { method: 'GET', credentials: 'include' });
    if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
    return await res.text();
  }

  // ---- 学年学期下拉 ----
  function readOptions(doc, id) {
    const sel = doc.querySelector('#' + id);
    if (!sel) return [];
    const list = [];
    Array.prototype.forEach.call(sel.querySelectorAll('option'), function (op) {
      const v = (op.getAttribute('value') || '').trim();
      if (!v) return;
      list.push({ text: (op.textContent || '').trim(), value: v, selected: op.hasAttribute('selected') });
    });
    return list;
  }

  async function chooseFrom(list, title) {
    if (!list.length) return null;
    // 只有一个选项时直接使用，避免多余的选择交互
    if (list.length === 1) return list[0];
    let def = 0;
    for (let i = 0; i < list.length; i++) { if (list[i].selected) { def = i; break; } }
    const r = await select(title, list.map(function (o) { return o.text; }), def);
    if (r === null || r === undefined || Number(r) < 0 || !list[Number(r)]) return null;
    return list[Number(r)];
  }

  async function chooseSemester() {
    const html = await getHtml(KB_INDEX);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const years = readOptions(doc, 'xnm');
    const terms = readOptions(doc, 'xqm');
    if (!years.length || !terms.length) throw new Error('未找到学年/学期下拉框，请确认已登录教务系统');
    const y = await chooseFrom(years, '选择学年');
    if (!y) return null;
    const t = await chooseFrom(terms, '选择学期');
    if (!t) return null;
    return { xnm: y.value, xqm: t.value, label: y.text + ' 第' + t.text + '学期' };
  }

  // ---- 周次 / 节次解析 ----
  function parseWeeks(zcd) {
    const out = {};
    let has = false;
    if (!zcd) return [];
    String(zcd).split(/[,，;；]/).forEach(function (part) {
      if (!part) return;
      const m = part.match(/(\d+)\s*(?:[-~－](\d+))?/);
      if (!m) return;
      let a = parseInt(m[1], 10);
      let b = m[2] ? parseInt(m[2], 10) : a;
      if (!a && !b) return;
      if (b < a) { const tmp = a; a = b; b = tmp; }
      const onlyOdd = /单/.test(part);
      const onlyEven = /双/.test(part);
      for (let w = a; w <= b && w <= 30; w++) {
        if (w < 1) continue;
        if (onlyOdd && w % 2 === 0) continue;
        if (onlyEven && w % 2 === 1) continue;
        out[w] = 1;
        has = true;
      }
    });
    if (!has) return [];
    return Object.keys(out).map(Number).sort(function (x, y) { return x - y; });
  }

  function parseJc(str) {
    if (!str) return null;
    const nums = String(str).match(/\d+/g);
    if (!nums || !nums.length) return null;
    let s = parseInt(nums[0], 10);
    let e = nums.length > 1 ? parseInt(nums[1], 10) : s;
    if (!s || !e) return null;
    if (e < s) { const t = s; s = e; e = t; }
    return { start: s, end: e };
  }

  function trimStr(s) { return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim(); }

  function normalizeCourses(list) {
    const rows = [];
    let bad = 0;
    (list || []).forEach(function (it) {
      const name = trimStr(it.kcmc);
      const teacher = trimStr(it.xm);
      const position = trimStr(it.cdmc || it.cd_id);
      const day = parseInt(it.xqj, 10);
      const jc = parseJc(it.jcs || it.jcor || it.jc);
      const weeks = parseWeeks(it.zcd);
      if (!name || !(day >= 1 && day <= 7) || !jc || !weeks.length) { bad++; return; }
      rows.push({
        name: name, teacher: teacher, position: position,
        day: day, startSection: jc.start, endSection: jc.end, weeks: weeks
      });
    });
    return { rows: rows, bad: bad };
  }

  function mergeCourses(rows) {
    // 阶段一：同课同周次、节次连续 → 合并节次
    const g1 = {};
    rows.forEach(function (r) {
      const k = [r.name, r.teacher, r.position, r.day, r.weeks.join('_')].join('|');
      (g1[k] = g1[k] || []).push(r);
    });
    const step1 = [];
    Object.keys(g1).forEach(function (k) {
      const arr = g1[k].slice().sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = null;
      arr.forEach(function (r) {
        if (cur && r.startSection <= cur.endSection + 1) {
          cur.endSection = Math.max(cur.endSection, r.endSection);
        } else {
          cur = {
            name: r.name, teacher: r.teacher, position: r.position, day: r.day,
            startSection: r.startSection, endSection: r.endSection, weeks: r.weeks.slice()
          };
          step1.push(cur);
        }
      });
    });
    // 阶段二：同课同节次 → 周次并集
    const g2 = {};
    step1.forEach(function (r) {
      const k = [r.name, r.teacher, r.position, r.day, r.startSection, r.endSection].join('|');
      if (!g2[k]) {
        g2[k] = {
          name: r.name, teacher: r.teacher, position: r.position, day: r.day,
          startSection: r.startSection, endSection: r.endSection, ws: {}
        };
      }
      r.weeks.forEach(function (w) { g2[k].ws[w] = 1; });
    });
    const out = Object.keys(g2).map(function (k) {
      const r = g2[k];
      return {
        name: r.name, teacher: r.teacher, position: r.position, day: r.day,
        startSection: r.startSection, endSection: r.endSection,
        weeks: Object.keys(r.ws).map(Number).sort(function (a, b) { return a - b; })
      };
    });
    out.sort(function (a, b) { return a.day - b.day || a.startSection - b.startSection; });
    return out;
  }

  async function fetchCourses(sem) {
    const body = 'xnm=' + encodeURIComponent(sem.xnm) + '&xqm=' + encodeURIComponent(sem.xqm) +
      '&kzlx=ck&xsdm=&kclbdm=&kclxdm=';
    const json = await postForm(KB_DATA, body);
    const list = (json && json.kbList) || [];
    const xqh = (list[0] && list[0].xqh_id) || '';
    return { list: list, xqh: xqh };
  }

  async function fetchTimeSlots(sem, xqh) {
    if (!xqh) return [];
    const body = 'xnm=' + encodeURIComponent(sem.xnm) + '&xqm=' + encodeURIComponent(sem.xqm) +
      '&xqh_id=' + encodeURIComponent(xqh);
    const json = await postForm(KB_JC, body);
    const list = Array.isArray(json) ? json : (json && Array.isArray(json.list) ? json.list : []);
    const slots = [];
    list.forEach(function (it) {
      const n = parseInt(it.jcmc, 10);
      const qs = trimStr(it.qssj);
      const js = trimStr(it.jssj);
      if (n > 0 && /^\d{1,2}:\d{2}$/.test(qs) && /^\d{1,2}:\d{2}$/.test(js)) {
        slots.push({ number: n, startTime: qs, endTime: js });
      }
    });
    slots.sort(function (a, b) { return a.number - b.number; });
    return slots;
  }

  async function runImportFlow() {
    const sem = await chooseSemester();
    if (!sem) { toast('已取消，未导入'); return; }

    const courseRes = await fetchCourses(sem);
    let timeSlots = [];
    try {
      timeSlots = await fetchTimeSlots(sem, courseRes.xqh);
    } catch (e) {
      toast('作息时间获取失败，已跳过');
    }

    const norm = normalizeCourses(courseRes.list);
    if (!norm.rows.length) throw new Error('该学期没有解析到任何课程');
    const courses = mergeCourses(norm.rows);

    let tip = '学期：' + sem.label + '\n课程：' + courses.length + ' 条';
    if (norm.bad) tip += '（跳过 ' + norm.bad + ' 条无效记录）';
    if (timeSlots.length) tip += '\n作息：' + timeSlots.length + ' 节';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    if (timeSlots.length) {
      const cfg = {};
      const a = timeSlots[0].startTime.split(':');
      const b = timeSlots[0].endTime.split(':');
      const dur = (parseInt(b[0], 10) * 60 + parseInt(b[1], 10)) -
        (parseInt(a[0], 10) * 60 + parseInt(a[1], 10));
      if (dur > 10 && dur < 180) cfg.defaultClassDuration = dur;
      if (Object.keys(cfg).length) {
        try {
          await BP.saveCourseConfig(JSON.stringify(cfg));
        } catch (e) {
          configFailed = true;
        }
      }
    }
    let slotsFailed = false;
    if (timeSlots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(timeSlots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + courses.length + ' 门课程' +
      (norm.bad ? '，跳过 ' + norm.bad + ' 条无效记录' : '') +
      (configFailed ? '（节次时长未保存）' : '') +
      (slotsFailed ? '（作息未保存）' : ''));
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
