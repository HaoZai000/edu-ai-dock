// 武夷学院（jwxt.wuyiu.edu.cn，金智 jsxsd）整学期课表适配器
(async function main() {
  const BASE = location.origin;
  const KB_URL = BASE + '/jsxsd/xskb/xskb_list.do';
  const CAL_URL = BASE + '/jsxsd/framework/mainv_zltable.jsp';

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

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  async function getDoc(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('网络错误 ' + res.status);
    const text = await res.text();
    if (!text || text.length < 500) throw new Error('返回内容为空，可能登录已失效');
    return new DOMParser().parseFromString(text, 'text/html');
  }

  /* ---------- 学年学期选择 ---------- */
  async function fetchAcademicOptions() {
    const doc = await getDoc(KB_URL + '?viweType=0');
    const sel = doc.querySelector('#xnxq01id');
    if (!sel) throw new Error('未找到学年学期下拉框，请确认已登录教务系统');
    const opts = Array.prototype.slice.call(sel.options).filter(function (o) { return !!o.value; });
    if (!opts.length) throw new Error('学年学期选项为空');
    let def = 0;
    opts.forEach(function (o, i) { if (o.selected) def = i; });
    return {
      labels: opts.map(function (o) { return (o.textContent || '').trim() || o.value; }),
      values: opts.map(function (o) { return o.value; }),
      defaultIndex: def
    };
  }

  async function chooseSemester() {
    const opt = await fetchAcademicOptions();
    // 只有一个学年学期时直接使用，避免多余的选择交互
    if (opt.labels.length === 1) return { value: opt.values[0], label: opt.labels[0] };
    const idx = await select('请选择学年学期', opt.labels, opt.defaultIndex);
    if (idx === null || idx === undefined || Number(idx) < 0 || !opt.values[Number(idx)]) return null;
    return { value: opt.values[Number(idx)], label: opt.labels[Number(idx)] };
  }

  /* ---------- 校历：开学日期与总周数 ---------- */
  const CN = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  function cnToInt(t) {
    t = String(t || '').replace(/第|周/g, '').trim();
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    if (t === '十') return 10;
    let m = t.match(/^([二三四五六七八九])十([一二三四五六七八九])?$/);
    if (m) return CN[m[1]] * 10 + (m[2] ? CN[m[2]] : 0);
    m = t.match(/^十([一二三四五六七八九])$/);
    if (m) return 10 + CN[m[1]];
    if (CN[t] !== undefined) return CN[t];
    return NaN;
  }
  function parseCalPage(doc, year, month) {
    const rows = [];
    const uls = doc.querySelectorAll('ul');
    for (let u = 0; u < uls.length; u++) {
      const title = uls[u].querySelector('li.first-title span');
      if (!title) continue;
      const w = cnToInt(title.textContent);
      if (!w || isNaN(w)) continue;
      const lis = uls[u].querySelectorAll('li');
      for (let i = 1; i < lis.length && i <= 7; i++) {
        const day = parseInt((lis[i].textContent || '').trim(), 10);
        if (day > 0) {
          const d = new Date(year, month - 1, day);
          rows.push({ week: w, monday: new Date(d.getTime() - (i - 1) * 86400000) });
          break;
        }
      }
    }
    return rows;
  }
  async function calMonth(y, m) {
    try {
      return parseCalPage(await getDoc(CAL_URL + '?ny=' + y + '-' + pad(m)), y, m);
    } catch (e) {
      return [];
    }
  }
  async function fetchCalendar(termCode) {
    const parts = String(termCode).split('-');
    const y1 = parseInt(parts[0], 10), y2 = parseInt(parts[1], 10), term = parseInt(parts[2], 10) || 1;
    const cands = term === 1
      ? [{ y: y1, m: 7 }, { y: y1, m: 8 }, { y: y1, m: 9 }]
      : [{ y: y2, m: 1 }, { y: y2, m: 2 }, { y: y2, m: 3 }];
    let startMonday = null, sy = 0, sm = 0;
    for (let i = 0; i < cands.length; i++) {
      const rows = await calMonth(cands[i].y, cands[i].m);
      for (let r = 0; r < rows.length; r++) {
        if (rows[r].week === 1) { startMonday = rows[r].monday; sy = cands[i].y; sm = cands[i].m; break; }
      }
      if (startMonday) break;
    }
    if (!startMonday) return null;
    let maxWeek = 1, y = sy, m = sm;
    for (let k = 0; k < 9; k++) {
      const rr = await calMonth(y, m);
      if (rr.length) {
        let mn = 99, mx = 0;
        rr.forEach(function (x) { mn = Math.min(mn, x.week); mx = Math.max(mx, x.week); });
        if (mn < maxWeek) break;
        maxWeek = Math.max(maxWeek, mx);
      }
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    if (maxWeek < 1) return null;
    return { semesterStartDate: fmtDate(startMonday), semesterTotalWeeks: maxWeek };
  }

  /* ---------- 课表解析 ---------- */
  function parseWeeks(str) {
    const set = {};
    String(str || '').split(/[,，、]/).forEach(function (part) {
      const odd = /单/.test(part), even = /双/.test(part);
      const m = part.match(/(\d+)\s*[-~～]\s*(\d+)/);
      if (m) {
        for (let i = parseInt(m[1], 10); i <= parseInt(m[2], 10) && i <= 30; i++) {
          if (i < 1) continue;
          if (odd && i % 2 === 0) continue;
          if (even && i % 2 === 1) continue;
          set[i] = 1;
        }
      } else {
        const n = part.match(/\d+/);
        if (n && parseInt(n[0], 10) >= 1 && parseInt(n[0], 10) <= 30) set[parseInt(n[0], 10)] = 1;
      }
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }
  function parseLi(li, day) {
    const titleEl = li.querySelector('.qz-hasCourse-title');
    const name = titleEl ? (titleEl.textContent || '').trim() : '';
    if (!name) return null;
    const text = (li.textContent || '').replace(/\s+/g, ' ').trim();
    const tm = text.match(/老师[:：]\s*([^;；]+)/) || text.match(/教师[:：]\s*([^;；\s]+)/);
    const wm = text.match(/时间[:：]\s*([\d,\-、()（）单双]+)\s*周/) || text.match(/\[([\d,\-、()（）单双]+)周\]/);
    const pm = text.match(/地点[:：]\s*([^;；]+?)\s*(?:;|；|$)/);
    const sm = text.match(/\[(\d+)\s*-\s*(\d+)节\]/) || text.match(/节次[:：]\s*(\d+)\s*[~～-]\s*(\d+)\s*小节/);
    if (!wm || !sm) return null;
    return {
      name: name,
      teacher: tm ? tm[1].trim() : '',
      position: pm ? pm[1].trim() : '',
      day: day,
      startSection: parseInt(sm[1], 10),
      endSection: parseInt(sm[2], 10),
      weeks: parseWeeks(wm[1])
    };
  }
  function parseCourses(doc) {
    const out = [];
    const rows = doc.querySelectorAll('table.qz-weeklyTable tbody tr');
    for (let i = 0; i < rows.length; i++) {
      const tds = rows[i].children;
      let day = 0;
      for (let j = 0; j < tds.length; j++) {
        const cls = tds[j].getAttribute('class') || '';
        if (/qz-weeklyTable-label/.test(cls)) continue;
        day += 1;
        const lis = tds[j].querySelectorAll('li.courselists-item');
        for (let k = 0; k < lis.length; k++) {
          const item = parseLi(lis[k], day);
          if (item) out.push(item);
        }
      }
    }
    return out;
  }
  function sameWeeks(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function keyOf(c) {
    return [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
  }
  function normalizeCourses(list) {
    const map = {};
    let skipped = 0;
    list.forEach(function (c) {
      if (!(c.day >= 1 && c.day <= 7)) { skipped++; return; }
      if (!(c.startSection >= 1 && c.endSection >= c.startSection)) { skipped++; return; }
      if (!c.weeks.length) { skipped++; return; }
      const k = keyOf(c);
      if (map[k]) {
        const s = {};
        map[k].weeks.concat(c.weeks).forEach(function (w) { s[w] = 1; });
        map[k].weeks = Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
      } else {
        map[k] = {
          name: c.name, position: c.position, teacher: c.teacher, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
        };
      }
    });
    const arr = Object.keys(map).map(function (k) { return map[k]; });
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < arr.length && !changed; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          if (a.name !== b.name || a.teacher !== b.teacher || a.position !== b.position || a.day !== b.day) continue;
          if (!sameWeeks(a.weeks, b.weeks)) continue;
          if (a.endSection + 1 === b.startSection) { a.endSection = b.endSection; arr.splice(j, 1); changed = true; break; }
          if (b.endSection + 1 === a.startSection) { a.startSection = b.startSection; arr.splice(j, 1); changed = true; break; }
        }
      }
    }
    return { courses: arr, skipped: skipped };
  }

  /* ---------- 主流程 ---------- */
  async function runImportFlow() {
    const term = await chooseSemester();
    if (!term) { toast('已取消，未导入'); return; }

    const pair = await Promise.all([
      getDoc(KB_URL + '?viweType=0&xnxq01id=' + encodeURIComponent(term.value)),
      fetchCalendar(term.value).catch(function () { return null; })
    ]);
    const doc = pair[0], cal = pair[1];
    const result = normalizeCourses(parseCourses(doc));
    if (!result.courses.length) throw new Error('该学期未解析到任何课程，请确认教务系统里是否有课表数据');

    let tip = '学期：' + term.label + '\n课程：' + result.courses.length + ' 门';
    if (result.skipped) tip += '（跳过 ' + result.skipped + ' 条不完整数据）';
    if (cal && cal.semesterStartDate) tip += '\n开学日期：' + cal.semesterStartDate;
    if (cal && cal.semesterTotalWeeks) tip += '\n教学周：' + cal.semesterTotalWeeks + ' 周';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(result.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    if (cal) {
      try {
        await BP.saveCourseConfig(JSON.stringify(cal));
      } catch (e) {
        configFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + result.courses.length + ' 门课程' +
      (result.skipped ? '，跳过 ' + result.skipped + ' 条不完整数据' : '') +
      (configFailed ? '（校历未保存）' : ''));
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
