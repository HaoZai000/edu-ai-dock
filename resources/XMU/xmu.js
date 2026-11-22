(async function main() {
  const BASE = location.origin;
  const API = {
    semesters: '/gsapp/sys/wdkbapp/modules/xskcb/kfdxnxqcx.do',
    schedule: '/gsapp/sys/wdkbapp/wdkcb/queryXspkjg.do',
    timeSlots: '/gsapp/sys/wdkbapp/wdkcb/queryXsskjc.do',
    student: '/gsapp/sys/wdkbapp/wdkcb/initXsxx.do?XH='
  };

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

  async function choose(title, labels, def) {
    if (labels.length === 1) return 0;
    const f = ui('showSingleSelection');
    if (!f) throw new Error('当前环境不支持选择');
    const r = await f(title, JSON.stringify(labels), def);
    if (r === null || r === undefined || r === -1) return -1;
    const n = Number(r);
    return Number.isInteger(n) && n >= 0 && n < labels.length ? n : -1;
  }

  async function post(path, body) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body || ''
    });
    if (!res.ok) throw new Error('请求失败(' + res.status + ')，请确认已登录');
    return await res.json();
  }

  async function fetchAcademicOptions() {
    const res = await post(API.semesters, '');
    const rows = (res && res.datas && res.datas.kfdxnxqcx && res.datas.kfdxnxqcx.rows) || [];
    return rows.map(function (r) {
      return {
        value: String(r.XNXQDM || ''),
        label: String(r.XNXQDM_DISPLAY || r.XNXQYWMC || r.XNXQDM || '')
      };
    }).filter(function (o) { return o.value; });
  }

  function detectDefaultIndex(options) {
    try {
      const selects = document.querySelectorAll('select');
      for (let i = 0; i < selects.length; i++) {
        const sel = selects[i];
        const o = sel.selectedOptions && sel.selectedOptions[0];
        if (!o) continue;
        const idx = options.findIndex(function (x) { return x.value === o.value || x.label === String(o.textContent || '').trim(); });
        if (idx >= 0) return idx;
      }
      const text = document.body ? (document.body.innerText || document.body.textContent || '') : '';
      const idx = options.findIndex(function (x) { return x.label && text.indexOf(x.label) >= 0; });
      if (idx >= 0) return idx;
    } catch (e) {}
    return 0;
  }

  async function fetchStudent() {
    const res = await fetch(BASE + API.student, { credentials: 'same-origin' });
    if (!res.ok) return '';
    const j = await res.json();
    return (j && j.data && j.data[0] && j.data[0].XH) ? String(j.data[0].XH) : '';
  }

  async function fetchSchedule(sem) {
    const res = await post(API.schedule, 'XNXQDM=' + encodeURIComponent(sem.value) + '&XH=');
    const ok = res && (res.success === true || res.success === 'true' || res.success === 1);
    if (!ok || !Array.isArray(res.pkjgList)) throw new Error('课表接口返回失败，请重新登录后重试');
    return res.pkjgList;
  }

  function fmtTime(n) {
    const s = String(n == null ? '' : n).trim();
    if (/^\d{1,2}:\d{2}$/.test(s)) {
      const p = s.split(':');
      return p[0].padStart(2, '0') + ':' + p[1];
    }
    const digits = s.replace(/\D/g, '').padStart(4, '0');
    if (digits.length < 4) return '';
    return digits.slice(0, 2) + ':' + digits.slice(2, 4);
  }

  async function fetchTimeSlots(sem, xh) {
    const res = await post(API.timeSlots, 'XNXQDM=' + encodeURIComponent(sem.value) + '&XH=' + encodeURIComponent(xh || ''));
    const rows = (res && res.data) || [];
    const map = new Map();
    rows.forEach(function (r) {
      const m = String(r.DM == null ? '' : r.DM).match(/\d+/);
      const n = m ? Number(m[0]) : NaN;
      const st = fmtTime(r.KSSJ);
      const et = fmtTime(r.JSSJ);
      if (!(n >= 1 && n <= 30) || !st || !et || map.has(n)) return;
      map.set(n, { number: n, startTime: st, endTime: et });
    });
    return Array.from(map.values()).sort(function (a, b) { return a.number - b.number; });
  }

  function parseZcmc(text) {
    if (!text) return [];
    const out = new Set();
    String(text).replace(/[周\s]/g, '').replace(/[()（）]/g, '').split(/[,，、;；]/).forEach(function (part) {
      const m = part.trim().match(/^(\d+)(?:[-~至到](\d+))?(单|双)?$/);
      if (!m) return;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      const parity = m[3];
      for (let w = Math.min(a, b); w <= Math.max(a, b) && w <= 30; w++) {
        if (w < 1) continue;
        if (parity === '单' && w % 2 === 0) continue;
        if (parity === '双' && w % 2 === 1) continue;
        out.add(w);
      }
    });
    return Array.from(out).sort(function (a, b) { return a - b; });
  }

  function parseWeeks(zcbh, zcmc) {
    let weeks = [];
    if (typeof zcbh === 'string' && zcbh.length) {
      for (let i = 0; i < zcbh.length && i < 30; i++) if (zcbh.charAt(i) === '1') weeks.push(i + 1);
    }
    if (!weeks.length) weeks = parseZcmc(zcmc);
    return weeks.sort(function (a, b) { return a - b; });
  }

  function normalizeCourses(list) {
    let skipped = 0;
    const arr = [];
    for (const r of list) {
      const name = String(r.KCMC || '').trim();
      const teacher = String(r.JSXM || '').trim();
      const position = String(r.JASMC || '').trim();
      const xq = Number(r.XQ);
      const ss = Number(r.KSJCDM);
      const es = Number(r.JSJCDM);
      const weeks = parseWeeks(r.ZCBH, r.ZCMC);
      if (!name || !(xq >= 1 && xq <= 7) || !(ss >= 1) || !(es >= ss) || es > 30 || !weeks.length) {
        skipped++;
        continue;
      }
      // 厦大课表以星期日为首列：XQ=1 是星期日，XQ=2..7 依次为周一..周六
      const day = xq === 1 ? 7 : xq - 1;
      arr.push({ name: name, teacher: teacher, position: position, day: day, startSection: ss, endSection: es, weeks: weeks });
    }

    arr.sort(function (a, b) {
      return a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) || a.day - b.day || a.startSection - b.startSection;
    });

    const g1 = new Map();
    arr.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      if (!g1.has(key)) g1.set(key, []);
      g1.get(key).push(c);
    });
    const phase1 = [];
    g1.forEach(function (group) {
      group.sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = Object.assign({}, group[0], { weeks: group[0].weeks.slice() });
      for (let i = 1; i < group.length; i++) {
        const c = group[i];
        if (c.startSection <= cur.endSection + 1) {
          cur.endSection = Math.max(cur.endSection, c.endSection);
        } else {
          phase1.push(cur);
          cur = Object.assign({}, c, { weeks: c.weeks.slice() });
        }
      }
      phase1.push(cur);
    });

    const g2 = new Map();
    phase1.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!g2.has(key)) g2.set(key, Object.assign({}, c, { weeks: [] }));
      const t = g2.get(key);
      t.weeks = Array.from(new Set(t.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
    });

    const courses = Array.from(g2.values()).sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
    return { courses: courses, skipped: skipped };
  }

  async function runImportFlow() {
    const go = await alert('导入课表', '将从教务系统读取所选学期的整学期课程，是否继续？', '继续');
    if (!go) {
      toast('已取消，未导入');
      return;
    }

    const options = await fetchAcademicOptions();
    if (!options.length) throw new Error('未获取到学期选项，请进入“我的课表”页面后重试');
    const picked = await choose('选择学年学期', options.map(function (o) { return o.label; }), detectDefaultIndex(options));
    if (picked < 0) {
      toast('已取消，未导入');
      return;
    }
    const sem = options[picked];

    toast('正在读取课表数据…');
    const xh = await fetchStudent().catch(function () { return ''; });
    const raw = await fetchSchedule(sem);
    const slots = await fetchTimeSlots(sem, xh).catch(function () { return []; });
    const result = normalizeCourses(raw);
    if (!result.courses.length) throw new Error('该学期没有解析到有效课程');

    const confirmed = await alert(
      '确认导入',
      '学期：' + sem.label +
        '\n课程：' + result.courses.length + ' 门' +
        (result.skipped ? '\n跳过异常：' + result.skipped + ' 条' : '') +
        '\n作息：' + (slots.length ? slots.length + ' 节' : '未取到') +
        '\n\n导入会覆盖当前课表。',
      '导入'
    );
    if (!confirmed) {
      toast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(result.courses));
    if (saved === false || saved === 'false') throw new Error('课程保存失败');

    let slotsFailed = false;
    if (slots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(slots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') BD.notifyTaskCompletion();
    toast('已导入 ' + result.courses.length + ' 门课程' +
      (result.skipped ? '，跳过 ' + result.skipped + ' 条异常数据' : '') +
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
