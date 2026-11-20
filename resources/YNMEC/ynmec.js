(async function main() {
  const BASE = location.origin;
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

  async function post(path, params) {
    const body = new URLSearchParams(params || {}).toString();
    const r = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body,
      credentials: 'same-origin'
    });
    if (!r.ok) throw new Error('请求失败 ' + path + ' (' + r.status + ')');
    return await r.json();
  }

  function unwrap(j, key) {
    if (!j || String(j.code) !== '0' || !j.datas) return null;
    return j.datas[key] || null;
  }

  function rowsOf(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.rows)) return v.rows;
    return [];
  }

  function pick(obj, names) {
    for (let i = 0; i < names.length; i++) {
      const v = obj ? obj[names[i]] : undefined;
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  async function fetchAcademicOptions() {
    const j = await post('/jwapp/sys/jwpubapp/modules/zdgl/xnxqcx.do', { '*order': '+DM' });
    const rows = rowsOf(unwrap(j, 'xnxqcx'));
    const opts = rows.map(function (r) { return { text: r.MC, value: r.DM }; })
      .filter(function (o) { return o.text && o.value; });
    let def = 0;
    try {
      const cj = await post('/jwapp/sys/jwpubapp/modules/gg/cxmrxnxq.do',
        { CSDM: 'SYS', ZCSDM: 'DQXNXQDM', SFSY: '1' });
      const crows = rowsOf(unwrap(cj, 'cxmrxnxq'));
      const dm = crows[0] && crows[0].XNXQDM;
      if (dm) {
        const i = opts.findIndex(function (o) { return o.value === dm; });
        if (i >= 0) def = i;
      }
    } catch (e) {}
    return { opts: opts, def: def };
  }

  async function chooseSemester() {
    const info = await fetchAcademicOptions();
    if (!info.opts.length) throw new Error('没有可用的学年学期选项');
    if (info.opts.length === 1) return info.opts[0].value;
    const sel = ui('showSingleSelection');
    if (!sel) throw new Error('当前环境不支持学期选择');
    const pickIdx = await sel('选择要导入的学年学期', JSON.stringify(info.opts.map(function (o) { return o.text; })), info.def);
    if (pickIdx === null || pickIdx === undefined || pickIdx === -1) return null;
    const idx = Number(pickIdx);
    if (!Number.isInteger(idx) || !info.opts[idx]) return null;
    return info.opts[idx].value;
  }

  function toMin(s) {
    if (!s || typeof s !== 'string' || s.indexOf(':') < 0) return null;
    const p = s.split(':').map(Number);
    if (!(p[0] >= 0 && p[1] >= 0)) return null;
    return p[0] * 60 + p[1];
  }

  function toHM(n) {
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  }

  function expandWeeks(w) {
    const out = [];
    if (typeof w !== 'string') return out;
    for (let i = 0; i < w.length && i < 30; i++) if (w.charAt(i) === '1') out.push(i + 1);
    return out;
  }

  function parseTeacher(s) {
    if (!s || typeof s !== 'string') return '';
    let m = s.match(/\/(.+?)\[主讲\]/);
    if (m) return m[1].trim();
    m = s.match(/\[讲授\]\/(.+)$/);
    if (m) return m[1].replace(/\[.*?\]/g, '').trim();
    return '';
  }

  // 优先使用教务返回的节次列表；字段名各校不一，做多重兼容
  function normalizeSlots(raw) {
    const list = rowsOf(raw);
    const map = new Map();
    list.forEach(function (s, i) {
      const numRaw = pick(s, ['section', 'JC', 'DM', 'sectionNumber', 'order', 'number', 'xh']);
      const m = String(numRaw == null ? '' : numRaw).match(/\d+/);
      const n = m ? parseInt(m[0], 10) : i + 1;
      const st = toMin(String(pick(s, ['beginTime', 'KSSJ', 'kssj', 'startTime']) || ''));
      const et = toMin(String(pick(s, ['endTime', 'JSSJ', 'jssj', 'endTime']) || ''));
      if (n >= 1 && n <= 30 && st !== null && et !== null && st < et && !map.has(n)) {
        map.set(n, { number: n, startTime: toHM(st), endTime: toHM(et) });
      }
    });
    return Array.from(map.values()).sort(function (a, b) { return a.number - b.number; });
  }

  // 节次列表拿不到时，才从课程起止时间推导
  function deriveTimeSlots(arrangedList) {
    const startVote = {};
    const endVote = {};
    const spans = {};
    arrangedList.forEach(function (c) {
      const bs = Number(c.beginSection);
      const es = Number(c.endSection);
      const bt = toMin(c.beginTime);
      const et = toMin(c.endTime);
      if (bs >= 1 && bt !== null) (startVote[bs] || (startVote[bs] = [])).push(bt);
      if (es >= 1 && et !== null) (endVote[es] || (endVote[es] = [])).push(et);
      const span = es - bs + 1;
      const dur = et !== null && bt !== null ? et - bt : 0;
      if (span >= 2 && dur > 0) (spans[span] || (spans[span] = [])).push(dur);
    });

    const mode = function (arr) {
      const m = {};
      arr.forEach(function (v) { m[v] = (m[v] || 0) + 1; });
      return Number(Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })[0]);
    };

    const start = {};
    const end = {};
    Object.keys(startVote).forEach(function (k) { start[k] = mode(startVote[k]); });
    Object.keys(endVote).forEach(function (k) { end[k] = mode(endVote[k]); });

    const minSpan = function (s) { return spans[s] ? Math.min.apply(null, spans[s]) : null; };
    const d2 = minSpan(2);
    const d3 = minSpan(3);
    let dur = 45;
    if (d2 && d3) {
      const brk = 2 * (d3 - d2) - d2;
      dur = (d3 - d2) - brk;
    } else if (d2) {
      dur = Math.round((d2 - 5) / 2);
    }
    if (!(dur >= 30 && dur <= 60)) dur = 45;

    const keys = Object.keys(start).concat(Object.keys(end)).map(Number);
    const maxSec = keys.length ? Math.max.apply(null, keys) : 0;
    const slots = [];
    for (let n = 1; n <= maxSec && n <= 30; n++) {
      let s = start[n];
      let e = end[n];
      if (s === undefined && e !== undefined) s = e - dur;
      if (e === undefined && s !== undefined) e = s + dur;
      if (s === undefined || e === undefined || !(s < e)) continue;
      slots.push({ number: n, startTime: toHM(s), endTime: toHM(e) });
    }
    return slots;
  }

  function normalizeCourses(arrangedList) {
    const bad = { count: 0, samples: [] };
    const items = [];
    arrangedList.forEach(function (c) {
      const day = Number(c.dayOfWeek);
      const ss = Number(c.beginSection);
      const es = Number(c.endSection);
      const weeks = expandWeeks(c.week);
      const ok = day >= 1 && day <= 7 && ss >= 1 && ss <= 20 && es >= ss && es <= 20 &&
        weeks.length > 0 && !!c.courseName;
      if (!ok) {
        bad.count++;
        if (bad.samples.length < 6) bad.samples.push(c.courseName || '(无名)');
        return;
      }
      items.push({
        name: c.courseName,
        position: c.placeName || '',
        teacher: parseTeacher(c.weeksAndTeachers),
        day: day,
        startSection: ss,
        endSection: es,
        weeks: weeks
      });
    });

    const keyA = function (c) {
      return [c.name, c.teacher, c.position, c.day, c.weeks.slice().sort(function (a, b) { return a - b; }).join(',')].join('|');
    };
    const gA = new Map();
    items.forEach(function (c) {
      const k = keyA(c);
      if (!gA.has(k)) gA.set(k, []);
      gA.get(k).push(c);
    });
    const stageA = [];
    gA.forEach(function (arr) {
      arr.sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = null;
      arr.forEach(function (c) {
        if (cur && c.startSection === cur.endSection + 1) {
          cur.endSection = c.endSection;
        } else {
          cur = {
            name: c.name, position: c.position, teacher: c.teacher, day: c.day,
            startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
          };
          stageA.push(cur);
        }
      });
    });

    const keyB = function (c) {
      return [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
    };
    const gB = new Map();
    stageA.forEach(function (c) {
      const k = keyB(c);
      if (!gB.has(k)) {
        gB.set(k, {
          name: c.name, position: c.position, teacher: c.teacher, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: new Set(c.weeks)
        });
      } else {
        const e = gB.get(k);
        c.weeks.forEach(function (w) { e.weeks.add(w); });
      }
    });

    const courses = Array.from(gB.values()).map(function (c) {
      return {
        name: c.name, position: c.position, teacher: c.teacher, day: c.day,
        startSection: c.startSection, endSection: c.endSection,
        weeks: Array.from(c.weeks).sort(function (a, b) { return a - b; })
      };
    });
    return { courses: courses, bad: bad };
  }

  async function runImportFlow() {
    const go = await alert('课表导入', '将从教务系统读取所选学期的整学期课表并导入，是否继续？', '开始导入');
    if (!go) {
      toast('已取消，未导入');
      return;
    }

    const XNXQDM = await chooseSemester();
    if (!XNXQDM) {
      toast('已取消，未导入');
      return;
    }
    toast('正在读取课表数据…');

    const campusRes = await post('/jwapp/sys/kbapp/api/wdkbcx/getMyScheduledCampus.do', { XNXQDM: XNXQDM });
    const [termRes, secRes] = await Promise.all([
      post('/jwapp/sys/kbbpapp/api/schoolCalendar/getTermWeeks.do', { XNXQDM: XNXQDM }).catch(function () { return null; }),
      post('/jwapp/sys/kbapp/api/wdkbcx/getMySectionList.do', { XNXQDM: XNXQDM }).catch(function () { return null; })
    ]);

    const campusList = rowsOf(unwrap(campusRes, 'getMyScheduledCampus'));
    let XQDM = campusList[0] && campusList[0].id;
    if (campusList.length > 1) {
      const sel = ui('showSingleSelection');
      if (!sel) throw new Error('当前环境不支持校区选择');
      const pickIdx = await sel('选择校区', JSON.stringify(campusList.map(function (c) { return c.name; })), 0);
      if (pickIdx === null || pickIdx === undefined || pickIdx === -1) {
        toast('已取消，未导入');
        return;
      }
      XQDM = campusList[Number(pickIdx)].id;
    }
    if (!XQDM) throw new Error('未能获取校区代码，无法读取课表');

    const schedRes = await post('/jwapp/sys/kbapp/api/wdkbcx/getMyScheduleDetail.do', { XNXQDM: XNXQDM, XQDM: XQDM });
    const detail = unwrap(schedRes, 'getMyScheduleDetail');
    if (!detail || !Array.isArray(detail.arrangedList) || !detail.arrangedList.length) {
      throw new Error('该学期没有读取到已安排的课程');
    }

    const norm = normalizeCourses(detail.arrangedList);
    if (!norm.courses.length) throw new Error('课程校验后为空，未导入');

    const sectionSlots = secRes ? normalizeSlots(unwrap(secRes, 'getMySectionList')) : [];
    const slots = sectionSlots.length ? sectionSlots : deriveTimeSlots(detail.arrangedList);
    const termWeeks = rowsOf(unwrap(termRes, 'getTermWeeks'));

    const badHint = norm.bad.count ? '\n跳过异常：' + norm.bad.count + ' 条' + (norm.bad.samples.length ? '（如 ' + norm.bad.samples.slice(0, 3).join('、') + '）' : '') : '';
    const confirmed = await alert(
      '确认导入',
      '课程：' + norm.courses.length + ' 门' + badHint +
        '\n周数：' + (termWeeks.length || '未取到') +
        '\n作息：' + (slots.length ? slots.length + ' 节' : '未取到') +
        '\n\n导入会覆盖当前课表。',
      '导入'
    );
    if (!confirmed) {
      toast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const cRes = await BP.saveImportedCourses(JSON.stringify(norm.courses));
    if (cRes === false || cRes === 'false') throw new Error('课程保存失败');

    let configFailed = false;
    let slotsFailed = false;
    if (termWeeks.length) {
      const startDate = String(termWeeks[0].startDate || '').slice(0, 10);
      const cfg = { semesterTotalWeeks: termWeeks.length };
      if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) cfg.semesterStartDate = startDate;
      if (slots.length) {
        const s = toMin(slots[0].startTime);
        const e = toMin(slots[0].endTime);
        if (s !== null && e !== null && e > s) cfg.defaultClassDuration = e - s;
      }
      try {
        await BP.saveCourseConfig(JSON.stringify(cfg));
      } catch (e) {
        configFailed = true;
      }
    }
    if (slots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(slots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') BD.notifyTaskCompletion();

    let msg = '导入完成：' + norm.courses.length + ' 门课';
    if (norm.bad.count) msg += '，跳过 ' + norm.bad.count + ' 条异常';
    if (configFailed || slotsFailed) msg += '（' + (configFailed ? '校历未保存 ' : '') + (slotsFailed ? '作息未保存' : '') + '）';
    toast(msg);
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
