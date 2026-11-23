// 湖南师范大学本科教学管理平台（EAMS）整学期课表适配器
(async function main() {
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

  async function fetchAcademicOptions() {
    const pageRes = await fetch('/eams/courseTableForStd.action', { credentials: 'same-origin' });
    if (!pageRes.ok) throw new Error('课表页请求失败：HTTP ' + pageRes.status);
    const pageHtml = await pageRes.text();
    const optRes = await fetch('/eams/dataQuery.action?dataType=semester', { credentials: 'same-origin' });
    if (!optRes.ok) throw new Error('学期列表请求失败：HTTP ' + optRes.status);
    const optHtml = await optRes.text();
    const doc = new DOMParser().parseFromString('<select>' + optHtml + '</select>', 'text/html');
    const options = [];
    doc.querySelectorAll('option').forEach(function (o) {
      const v = o.getAttribute('value');
      const t = (o.textContent || '').trim();
      if (v && t) options.push({ value: v, text: t });
    });
    if (!options.length) throw new Error('未获取到学年学期列表，请确认已登录教务系统');

    const cm = pageHtml.indexOf('value:"');
    let cur = '';
    if (cm >= 0) {
      const j = cm + 'value:"'.length;
      let k = j;
      while (k < pageHtml.length && pageHtml.charAt(k) !== '"') k++;
      cur = pageHtml.substring(j, k);
    }
    let defaultIdx = 0;
    for (let i = 0; i < options.length; i++) {
      if (options[i].value === cur) { defaultIdx = i; break; }
    }

    const marker = 'form,"ids","';
    const mi = pageHtml.indexOf(marker);
    let ids = '';
    if (mi >= 0) {
      const j = pageHtml.indexOf('"', mi + marker.length);
      ids = pageHtml.substring(mi + marker.length, j);
    }
    return { options: options, defaultIdx: defaultIdx, ids: ids };
  }

  async function fetchCourseTable(semesterId, ids) {
    const body = new URLSearchParams();
    body.append('ignoreHead', '1');
    body.append('setting.kind', 'std');
    body.append('startWeek', '');
    body.append('semester.id', semesterId);
    body.append('ids', ids);
    const res = await fetch('/eams/courseTableForStd!courseTable.action', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString()
    });
    if (!res.ok) throw new Error('课表请求失败：HTTP ' + res.status);
    const html = await res.text();
    if (!/TaskActivity|actTeachers/.test(html)) {
      throw new Error('课表数据为空，可能登录已失效或该学期未排课');
    }
    return html;
  }

  function literalsOf(s) {
    const Q = String.fromCharCode(34);
    const BS = String.fromCharCode(92);
    const out = [];
    let i = 0;
    while (i < s.length) {
      if (s.charAt(i) === Q) {
        let v = '';
        i++;
        while (i < s.length && s.charAt(i) !== Q) {
          if (s.charAt(i) === BS && i + 1 < s.length) { v += s.charAt(i + 1); i += 2; }
          else { v += s.charAt(i); i++; }
        }
        i++;
        out.push(v);
      } else i++;
    }
    return out;
  }

  function extractActivities(html) {
    const Q = String.fromCharCode(34);
    const SQ = String.fromCharCode(39);
    const BS = String.fromCharCode(92);
    const teacherArrays = [];
    const tMarker = 'actTeachers = [';
    let tp = 0;
    while (true) {
      const ti = html.indexOf(tMarker, tp);
      if (ti < 0) break;
      const begin = ti + tMarker.length;
      const end = html.indexOf(']', begin);
      if (end < 0) break;
      const chunk = html.substring(begin, end);
      const names = [];
      const nMarker = 'name:"';
      let nq = 0;
      while (true) {
        const ni = chunk.indexOf(nMarker, nq);
        if (ni < 0) break;
        const ns = ni + nMarker.length;
        const ne = chunk.indexOf('"', ns);
        if (ne < 0) break;
        names.push(chunk.substring(ns, ne));
        nq = ne + 1;
      }
      teacherArrays.push(names.join(','));
      tp = end + 1;
    }
    const calls = [];
    const key = 'new TaskActivity(';
    let pos = 0;
    while (true) {
      const start = html.indexOf(key, pos);
      if (start < 0) break;
      let i = start + key.length, depth = 1, inS = false, inD = false;
      while (i < html.length && depth > 0) {
        const ch = html.charAt(i);
        if (ch === BS) { i += 2; continue; }
        if (ch === SQ && !inD) inS = !inS;
        else if (ch === Q && !inS) inD = !inD;
        else if (!inS && !inD) {
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
        }
        i++;
      }
      calls.push({ pos: start, lits: literalsOf(html.substring(start + key.length, i - 1)) });
      pos = i;
    }
    const idxEvents = [];
    const iMarker = 'index =';
    let ip = 0;
    while (true) {
      const ii = html.indexOf(iMarker, ip);
      if (ii < 0) break;
      const star = html.indexOf('*', ii);
      const plus = html.indexOf('+', ii);
      const semi = html.indexOf(';', ii);
      if (star > ii && plus > star && semi > plus) {
        const dayStr = html.substring(ii + iMarker.length, star).trim();
        const secStr = html.substring(plus + 1, semi).trim();
        if (/^[0-9]+$/.test(dayStr) && /^[0-9]+$/.test(secStr)) {
          idxEvents.push({ pos: ii, day: parseInt(dayStr, 10), section: parseInt(secStr, 10) });
        }
      }
      ip = ii + iMarker.length;
    }
    const events = [];
    calls.forEach(function (c, k) {
      events.push({ pos: c.pos, type: 'call', lits: c.lits, teacher: teacherArrays[k] || '' });
    });
    idxEvents.forEach(function (e) {
      events.push({ pos: e.pos, type: 'index', day: e.day, section: e.section });
    });
    events.sort(function (a, b) { return a.pos - b.pos; });
    const records = [];
    let cur = null;
    events.forEach(function (ev) {
      if (ev.type === 'call') {
        cur = { lits: ev.lits, teacher: ev.teacher, day: null, sections: [] };
        records.push(cur);
      } else if (cur) {
        cur.day = ev.day;
        cur.sections.push(ev.section);
      }
    });
    return records;
  }

  function parseCourses(html) {
    let from = 1, totalWeeks = 20;
    const ti = html.indexOf('marshalTable(');
    if (ti >= 0) {
      const q = ti + 'marshalTable('.length;
      const end = html.indexOf(')', q);
      const nums = [];
      html.substring(q, end).split(',').forEach(function (x) {
        const v = x.trim();
        if (/^[0-9]+$/.test(v)) nums.push(parseInt(v, 10));
      });
      if (nums.length >= 3) { from = nums[0]; totalWeeks = nums[2]; }
    }
    const records = extractActivities(html);
    const list = [];
    records.forEach(function (r) {
      if (r.day === null || !r.sections.length || r.lits.length < 5) return;
      let name = r.lits[1] || '';
      const lp = name.lastIndexOf('(');
      if (lp > 0 && name.charAt(name.length - 1) === ')') name = name.substring(0, lp);
      name = name.trim();
      if (!name) return;
      const bits = r.lits[4] || '';
      const weeks = [];
      for (let w = 1; w <= totalWeeks && w <= 30; w++) {
        if (bits.charAt(from + w - 2) === '1') weeks.push(w);
      }
      if (!weeks.length) return;
      list.push({
        name: name,
        teacher: r.teacher,
        position: r.lits[3] || '',
        day: r.day + 1,
        startSection: Math.min.apply(null, r.sections) + 1,
        endSection: Math.max.apply(null, r.sections) + 1,
        weeks: weeks
      });
    });
    return { courses: list, totalWeeks: totalWeeks };
  }

  function parseTimeSlots(html) {
    const slots = [];
    let p = 0;
    while (true) {
      const oi = html.indexOf('(', p);
      if (oi < 0) break;
      const ci = html.indexOf(')', oi + 1);
      if (ci < 0) break;
      const inner = html.substring(oi + 1, ci);
      const parts = inner.split('-');
      if (parts.length === 2) {
        const a = parts[0].trim();
        const b = parts[1].trim();
        if (/^[0-9]{1,2}:[0-9]{2}$/.test(a) && /^[0-9]{1,2}:[0-9]{2}$/.test(b)) {
          slots.push({ number: slots.length + 1, startTime: a, endTime: b });
        }
      }
      p = ci + 1;
    }
    return slots;
  }

  function sameWeeks(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function normalizeCourses(list) {
    const valid = [];
    let skipped = 0;
    list.forEach(function (c) {
      if (!(c.day >= 1 && c.day <= 7) || !(c.startSection >= 1) || !(c.endSection >= c.startSection)
          || !Array.isArray(c.weeks) || !c.weeks.length) { skipped++; return; }
      valid.push(c);
    });
    const stage1 = [];
    valid.forEach(function (c) {
      let found = null;
      for (let i = 0; i < stage1.length; i++) {
        const x = stage1[i];
        if (x.name === c.name && x.teacher === c.teacher && x.position === c.position && x.day === c.day
            && sameWeeks(x.weeks, c.weeks)
            && (x.endSection + 1 === c.startSection || c.endSection + 1 === x.startSection)) { found = x; break; }
      }
      if (found) {
        found.startSection = Math.min(found.startSection, c.startSection);
        found.endSection = Math.max(found.endSection, c.endSection);
      } else stage1.push({
        name: c.name, teacher: c.teacher, position: c.position, day: c.day,
        startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
      });
    });
    const result = [];
    stage1.forEach(function (c) {
      let found = null;
      for (let i = 0; i < result.length; i++) {
        const x = result[i];
        if (x.name === c.name && x.teacher === c.teacher && x.position === c.position && x.day === c.day
            && x.startSection === c.startSection && x.endSection === c.endSection) { found = x; break; }
      }
      if (found) {
        const set = {};
        found.weeks.concat(c.weeks).forEach(function (w) { set[w] = true; });
        found.weeks = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
      } else result.push({
        name: c.name, teacher: c.teacher, position: c.position, day: c.day,
        startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
      });
    });
    return { courses: result, skipped: skipped };
  }

  async function runImportFlow() {
    const ac = await fetchAcademicOptions();
    let sem;
    // 只有一个学期时直接使用，避免多余的选择交互
    if (ac.options.length === 1) {
      sem = ac.options[0];
    } else {
      const picked = await select('选择学期', ac.options.map(function (o) { return o.text; }), ac.defaultIdx);
      if (picked === null || picked === undefined || Number(picked) < 0 || !ac.options[Number(picked)]) {
        toast('已取消，未导入');
        return;
      }
      sem = ac.options[Number(picked)];
    }

    const html = await fetchCourseTable(sem.value, ac.ids);
    const parsed = parseCourses(html);
    const norm = normalizeCourses(parsed.courses);
    const slots = parseTimeSlots(html);
    if (!norm.courses.length) throw new Error('未解析到课程，请确认该学期课表已排定');

    let tip = '学期：' + sem.text + '\n课程：' + norm.courses.length + ' 条';
    if (norm.skipped) tip += '（跳过 ' + norm.skipped + ' 条异常）';
    if (parsed.totalWeeks > 0) tip += '\n教学周：' + parsed.totalWeeks + ' 周';
    if (slots.length) tip += '\n作息：' + slots.length + ' 节';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(norm.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    if (parsed.totalWeeks > 0) {
      // 只写接口返回的真实总周数，不猜开学日期与星期基准
      try {
        await BP.saveCourseConfig(JSON.stringify({ semesterTotalWeeks: parsed.totalWeeks }));
      } catch (e) {
        configFailed = true;
      }
    }
    let slotsFailed = false;
    if (slots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(slots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + norm.courses.length + ' 条课程' +
      (norm.skipped ? '，跳过 ' + norm.skipped + ' 条异常' : '') +
      (configFailed ? '（教学周未保存）' : '') +
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
