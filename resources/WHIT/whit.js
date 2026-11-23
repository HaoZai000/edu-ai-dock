(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BD = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  function toast(msg) {
    if (BD && typeof BD.showToast === 'function') { try { BD.showToast(msg); } catch (e) {} }
  }
  async function alert(title, content, confirmText) {
    if (!BP || typeof BP.showAlert !== 'function') return true;
    return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
  }
  async function select(title, labels, def) {
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    const picked = await BP.showSingleSelection(title, JSON.stringify(labels), def);
    if (picked === null || picked === undefined || Number(picked) === -1 || isNaN(Number(picked))) return null;
    return Number(picked);
  }
  async function saveCourses(courses) {
    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const ok = await BP.saveImportedCourses(JSON.stringify(courses));
    if (ok === false || ok === 'false' || ok === null) throw new Error('课程保存失败');
  }
  function finish() {
    if (BD && typeof BD.notifyTaskCompletion === 'function') { try { BD.notifyTaskCompletion(); } catch (e) {} }
  }

  const BASE = location.origin + '/jwgl/';
  const post = async function (path, data) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams(data || {}).toString()
    });
    if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new Error(path + ' 返回非 JSON'); }
  };
  const minutes = function (t) {
    const p = String(t || '').split(':').map(Number);
    return p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p[0] * 60 + p[1] : NaN;
  };
  const parseKkxq = function (s) {
    const m = /^(\d{4})-(\d{4})-([12])$/.exec(String(s || '').trim());
    return m ? { y1: Number(m[1]), term: Number(m[3]) } : null;
  };
  const guessCurrent = function () {
    try {
      const raw = sessionStorage.getItem('_global.zcInfo');
      if (raw) {
        const o = JSON.parse(raw);
        if (o && parseKkxq(o.KKXQ_T)) return String(o.KKXQ_T).trim();
      }
    } catch (e) {}
    const now = new Date();
    const y = now.getFullYear();
    const mth = now.getMonth() + 1;
    const y1 = mth >= 9 ? y : y - 1;
    return y1 + '-' + (y1 + 1) + '-' + (mth >= 2 && mth <= 8 ? 2 : 1);
  };
  const buildOptions = function (cur) {
    const o = parseKkxq(cur);
    if (!o) return { list: [cur], def: 0 };
    const list = [];
    for (const y of [o.y1 - 1, o.y1]) {
      list.push(y + '-' + (y + 1) + '-1');
      list.push(y + '-' + (y + 1) + '-2');
    }
    const idx = list.indexOf(cur);
    return { list: list, def: idx >= 0 ? idx : 0 };
  };
  const expandWeeks = function (it) {
    const out = new Set();
    const list = Array.isArray(it.beWeekList) ? it.beWeekList : [];
    for (const b of list) {
      const begin = Number(b.begin);
      const end = Number(b.end);
      if (!Number.isFinite(begin) || !Number.isFinite(end) || end < begin) continue;
      const wt = String(b.wtName || it.wtName || '');
      const both = wt.indexOf('单') >= 0 && wt.indexOf('双') >= 0;
      for (let w = begin; w <= Math.min(end, 30); w++) {
        if (w < 1) continue;
        if (!both && wt.indexOf('单') >= 0 && w % 2 === 0) continue;
        if (!both && wt.indexOf('双') >= 0 && w % 2 === 1) continue;
        out.add(w);
      }
    }
    return [...out].sort(function (a, b) { return a - b; });
  };
  const normalizeCourses = function (raw) {
    let bad = 0;
    const groups = new Map();
    for (const it of raw) {
      const name = String(it.lessonName || it.nameForKbxs || '').trim();
      const day = Number(it.week);
      const sec = Number(it.section);
      const weeks = expandWeeks(it);
      if (!name || !(day >= 1 && day <= 7) || !(sec >= 1) || !(sec <= 30) || weeks.length === 0) { bad++; continue; }
      const teacher = String(it.tchName || '').trim();
      const position = String(it.crName || '').trim();
      const key = [name, teacher, position, day].join('|');
      if (!groups.has(key)) groups.set(key, new Map());
      const byWeeks = groups.get(key);
      const sig = weeks.join(',');
      if (!byWeeks.has(sig)) byWeeks.set(sig, { name: name, teacher: teacher, position: position, day: day, weeks: weeks, sections: new Set() });
      byWeeks.get(sig).sections.add(sec);
    }
    const list = [];
    for (const byWeeks of groups.values()) {
      for (const g of byWeeks.values()) {
        const secs = [...g.sections].sort(function (a, b) { return a - b; });
        let start = secs[0];
        let prev = secs[0];
        const ranges = [];
        for (let i = 1; i < secs.length; i++) {
          if (secs[i] === prev + 1) prev = secs[i];
          else { ranges.push([start, prev]); start = prev = secs[i]; }
        }
        ranges.push([start, prev]);
        for (const r of ranges) {
          list.push({ name: g.name, position: g.position, teacher: g.teacher, day: g.day, startSection: r[0], endSection: r[1], weeks: g.weeks.slice() });
        }
      }
    }
    const merged = new Map();
    for (const c of list) {
      const k = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!merged.has(k)) {
        merged.set(k, c);
      } else {
        const t = merged.get(k);
        t.weeks = [...new Set([...t.weeks, ...c.weeks])].sort(function (a, b) { return a - b; });
      }
    }
    return { courses: [...merged.values()], bad: bad };
  };
  const buildTimeSlots = function (arr, semester) {
    const valid = (Array.isArray(arr) ? arr : []).filter(function (x) { return x && x.xlkssj && x.xljssj && x.xh != null; });
    let use = valid.filter(function (x) { return String(x.kkxq_t || '').trim() === semester; });
    if (!use.length) use = valid;
    const byNum = new Map();
    for (const x of use) {
      const n = Number(x.xh);
      if (!Number.isFinite(n) || n < 1) continue;
      if (!byNum.has(n)) byNum.set(n, { number: n, startTime: String(x.xlkssj).slice(0, 5), endTime: String(x.xljssj).slice(0, 5) });
    }
    return [...byNum.values()].sort(function (a, b) { return a.number - b.number; });
  };

  async function runImportFlow() {
    const cur = guessCurrent();
    const opts = buildOptions(cur);
    const picked = await select('选择要导入的学期', opts.list, opts.def);
    if (picked === null) { toast('已取消导入'); return; }
    const semester = opts.list[picked] || cur;

    let xh = '';
    try {
      const info = await post('loginService/getPhoneMainInfo');
      xh = String((info && info.xh) || '').trim();
    } catch (e) {}
    if (!xh) { try { xh = String(localStorage.getItem('userid') || '').trim(); } catch (e) {} }
    if (!xh) {
      await alert('无法获取学号', '请重新登录教务系统后再试。', '知道了');
      return;
    }

    const ok = await alert('确认导入', '将导入「' + semester + '」整学期课表，是否继续？', '开始导入');
    if (!ok) { toast('已取消导入'); return; }

    const res = await Promise.all([
      post('timetableController/timetable', { xh: xh, qz: '', mz: '', kkxq: semester, type: 'student' }).catch(function () { return null; }),
      post('baseInfoController/getScheduleTime', {}).catch(function () { return null; })
    ]);
    const ttRes = res[0];
    const stRes = res[1];
    const raw = ttRes && Array.isArray(ttRes.list) ? ttRes.list : [];
    if (!raw.length) {
      await alert('没有拿到课表', '学期 ' + semester + ' 未返回课程数据，可能该学期无课或需要重新登录。', '知道了');
      return;
    }
    const norm = normalizeCourses(raw);
    const courses = norm.courses;
    if (!courses.length) {
      await alert('课程解析失败', '接口返回 ' + raw.length + ' 条记录，但都无法解析出星期/节次/周次。', '知道了');
      return;
    }
    const slots = buildTimeSlots(stRes, semester);

    await saveCourses(courses);

    const maxWeek = Math.max.apply(null, courses.flatMap(function (c) { return c.weeks; }));
    const cfg = { semesterTotalWeeks: maxWeek, firstDayOfWeek: 1 };
    if (slots.length) {
      const dur = minutes(slots[0].endTime) - minutes(slots[0].startTime);
      if (dur > 0) cfg.defaultClassDuration = dur;
      if (slots.length > 1) {
        const brk = minutes(slots[1].startTime) - minutes(slots[0].endTime);
        if (brk > 0) cfg.defaultBreakDuration = brk;
      }
    }
    try { await BP.saveCourseConfig(JSON.stringify(cfg)); } catch (e) {}
    if (slots.length) { try { await BP.savePresetTimeSlots(JSON.stringify(slots)); } catch (e) {} }

    toast('已导入 ' + courses.length + ' 条课程' + (norm.bad ? '（跳过 ' + norm.bad + ' 条异常记录）' : ''));
    finish();
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
