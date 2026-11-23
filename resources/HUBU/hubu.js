// 湖北大学（jwxt.hubu.edu.cn，金智 jsxsd 教务）整学期课表适配器
(async function main() {
  const BASE = location.origin + '/jsxsd';

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

  const clean = (s) => String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const parseDoc = (html) => new DOMParser().parseFromString(html, 'text/html');
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const hm2min = (s) => { const p = s.split(':').map(Number); return p[0] * 60 + p[1]; };
  const min2hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0');

  async function getText(url, opt) {
    const res = await fetch(url, opt || {});
    const html = await res.text();
    if (!/kbtable|kbcontent|xnxq01id/.test(html) && /login|Logon/i.test(html)) {
      throw new Error('登录状态已失效，请重新登录教务系统');
    }
    return html;
  }

  // ---------- 1. 选项 ----------
  async function fetchAcademicOptions() {
    const html = await getText(BASE + '/xskb/xskb_list.do');
    const doc = parseDoc(html);
    const pick = (sel) => Array.from(doc.querySelectorAll(sel)).map((o) => ({
      value: o.getAttribute('value') || '',
      label: clean(o.textContent),
      selected: o.hasAttribute('selected')
    }));
    const terms = pick('#xnxq01id option').filter((o) => o.value);
    const cms = pick('#kbjcmsid option').filter((o) => o.value);
    if (!terms.length) throw new Error('课表页没有解析到学年学期下拉框');
    return { terms, cms };
  }

  async function chooseSemester(terms) {
    // 只有一个学期时直接使用，避免多余的选择交互
    if (terms.length === 1) return terms[0];
    const defaultIdx = Math.max(0, terms.findIndex((t) => t.selected));
    const picked = await select('选择要导入的学期', terms.map((t) => t.label), defaultIdx);
    if (picked === null || picked === undefined || Number(picked) < 0 || !terms[Number(picked)]) return null;
    return terms[Number(picked)];
  }

  // ---------- 2. 作息 ----------
  function parseTimeSlots(doc) {
    const slots = [];
    let idx = 1;
    Array.from(doc.querySelectorAll('#kbtable tr')).forEach((tr) => {
      const th = tr.querySelector('th');
      if (!th) return;
      const m = clean(th.textContent).match(/(\d{1,2}:\d{2})\s*[-–~至]\s*(\d{1,2}:\d{2})/);
      if (!m) return;
      const s = hm2min(m[1]), e = hm2min(m[2]);
      const dur = e - s;
      if (dur <= 0) return;
      let n = Math.max(1, Math.round((dur + 10) / 55));
      while (n > 1 && (dur - 10 * (n - 1)) / n < 25) n--;
      const per = (dur - 10 * (n - 1)) / n;
      for (let k = 0; k < n; k++) {
        const st = s + k * (per + 10);
        slots.push({ number: idx++, startTime: min2hm(st), endTime: min2hm(st + per) });
      }
    });
    return slots;
  }

  function rowRanges(doc) {
    const out = [];
    Array.from(doc.querySelectorAll('#kbtable tr')).forEach((tr) => {
      const th = tr.querySelector('th');
      if (!th) { out.push(null); return; }
      const m = clean(th.textContent).match(/(\d{1,2}:\d{2})\s*[-–~至]\s*(\d{1,2}:\d{2})/);
      if (!m) { out.push(null); return; }
      const dur = hm2min(m[2]) - hm2min(m[1]);
      let n = Math.max(1, Math.round((dur + 10) / 55));
      while (n > 1 && (dur - 10 * (n - 1)) / n < 25) n--;
      out.push(n);
    });
    return out;
  }

  // ---------- 3. 周次/节次解析 ----------
  function parseWeeks(txt) {
    const t = String(txt || '').replace(/\[[^\]]*\]/g, ' ');
    const odd = /单/.test(t), even = /双/.test(t);
    const nums = new Set();
    t.replace(/(\d{1,2})\s*[-–~至]\s*(\d{1,2})/g, (m, a, b) => {
      a = +a; b = +b;
      for (let i = a; i <= b && i <= 30; i++) nums.add(i);
      return m;
    });
    const rest = t.replace(/(\d{1,2})\s*[-–~至]\s*(\d{1,2})/g, ' ');
    rest.replace(/\d{1,2}/g, (m) => { nums.add(+m); return m; });
    let arr = Array.from(nums).filter((n) => n >= 1 && n <= 30);
    if (odd) arr = arr.filter((n) => n % 2 === 1);
    if (even) arr = arr.filter((n) => n % 2 === 0);
    return arr.sort((a, b) => a - b);
  }

  function courseNameFromDiv(d) {
    const head = String(d.innerHTML || '').split(/<font/i)[0];
    return clean(head.replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' '));
  }

  function parseCourses(doc) {
    const list = [], bad = [];
    const rows = Array.from(doc.querySelectorAll('#kbtable tr'));
    const ranges = rowRanges(doc);
    let rangeIdx = -1, acc = 0;
    rows.forEach((tr, ri) => {
      const th = tr.querySelector('th');
      const tds = Array.from(tr.querySelectorAll('td'));
      if (!th || tds.length !== 7) return;
      if (ranges[ri]) { acc += ranges[ri]; rangeIdx = acc; }
      const rowStart = rangeIdx ? rangeIdx - (ranges[ri] || 0) + 1 : null;
      const rowEnd = rangeIdx || null;
      tds.forEach((td, ci) => {
        const day = ci + 1;
        Array.from(td.querySelectorAll('div.kbcontent')).forEach((d) => {
          const name = courseNameFromDiv(d);
          if (!name) return;
          const weekEls = Array.from(d.querySelectorAll('font[title="周次(节次)"]'));
          const tEls = Array.from(d.querySelectorAll('font[title="老师"]'));
          const rEls = Array.from(d.querySelectorAll('font[title="教室"]'));
          if (!weekEls.length) { bad.push(name + '：无周次信息'); return; }
          weekEls.forEach((w, k) => {
            const wt = clean(w.textContent);
            const weeks = parseWeeks(wt);
            if (!weeks.length) { bad.push(name + '：周次无法解析(' + wt + ')'); return; }
            let st = null, en = null;
            const mm = wt.match(/\[(\d{1,2})\s*[-–~至]\s*(\d{1,2})\s*节?\]/);
            if (mm) { st = +mm[1]; en = +mm[2]; }
            else {
              const m1 = wt.match(/\[(\d{1,2})\s*节?\]/);
              if (m1) { st = en = +m1[1]; }
              else if (rowStart) { st = rowStart; en = rowEnd; }
            }
            if (!st || !en || en < st) { bad.push(name + '：节次无法解析(' + wt + ')'); return; }
            list.push({
              name,
              teacher: clean((tEls[k] || tEls[0] || {}).textContent || ''),
              position: clean((rEls[k] || rEls[0] || {}).textContent || ''),
              day,
              startSection: st,
              endSection: en,
              weeks
            });
          });
        });
      });
    });
    return { list, bad };
  }

  // ---------- 4. 校验与合并 ----------
  function normalizeCourses(list) {
    const valid = [];
    let dropped = 0;
    list.forEach((c) => {
      if (!c.name || !(c.day >= 1 && c.day <= 7) || !(c.startSection >= 1) ||
          !(c.endSection >= c.startSection) || !c.weeks || !c.weeks.length) dropped++;
      else valid.push(c);
    });
    const map = new Map();
    valid.forEach((c) => {
      const k = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!map.has(k)) map.set(k, Object.assign({}, c, { weeks: new Set(c.weeks) }));
      else c.weeks.forEach((w) => map.get(k).weeks.add(w));
    });
    let arr = Array.from(map.values()).map((c) =>
      Object.assign({}, c, { weeks: Array.from(c.weeks).sort((a, b) => a - b) }));
    let changed = true;
    while (changed) {
      changed = false;
      outer:
      for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr.length; j++) {
          if (i === j) continue;
          const a = arr[i], b = arr[j];
          if (a.name === b.name && a.teacher === b.teacher && a.position === b.position && a.day === b.day &&
              a.endSection + 1 === b.startSection && a.weeks.join(',') === b.weeks.join(',')) {
            arr[i] = Object.assign({}, a, { endSection: b.endSection });
            arr.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
    return { courses: arr, dropped };
  }

  // ---------- 5. 学期信息（开学日期 / 总周数） ----------
  async function fetchSemesterInfo(cmsid) {
    try {
      const today = new Date();
      const body = 'rq=' + ymd(today) + '&sjmsValue=' + encodeURIComponent(cmsid || '');
      const res = await fetch(BASE + '/framework/main_index_loadkb.jsp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const html = await res.text();
      const m = html.match(/第\s*(\d+)\s*周\s*\/\s*(\d+)\s*周/);
      if (!m) return null;
      const cur = +m[1], total = +m[2];
      if (!(cur > 0 && total > 0)) return null;
      return {
        semesterTotalWeeks: total,
        semesterStartDate: ymd(new Date(today.getTime() - (cur - 1) * 7 * 86400000))
      };
    } catch (e) { return null; }
  }

  async function runImportFlow() {
    const opts = await fetchAcademicOptions();
    const term = await chooseSemester(opts.terms);
    if (!term) { toast('已取消，未导入'); return; }

    const cmsList = opts.cms.length ? opts.cms.map((c) => c.value) : [''];
    const pages = await Promise.all(cmsList.map(async (cms) => {
      try {
        const url = BASE + '/xskb/xskb_list.do?xnxq01id=' + encodeURIComponent(term.value) +
          '&zc=&kbjcmsid=' + encodeURIComponent(cms);
        const html = await getText(url);
        const doc = parseDoc(html);
        const parsed = parseCourses(doc);
        return { cms, doc, list: parsed.list, bad: parsed.bad, slots: parseTimeSlots(doc) };
      } catch (e) {
        return { cms, doc: null, list: [], bad: [], slots: [], err: e.message };
      }
    }));

    const usable = pages.filter((p) => p.list.length > 0).sort((a, b) => b.list.length - a.list.length);
    if (!usable.length) {
      const errs = pages.map((p) => p.err).filter(Boolean).join(' / ');
      throw new Error('该学期没有查到课程' + (errs ? '（' + errs + '）' : '，可能课表未排定或需要在教务里选对学期'));
    }

    const raw = [];
    usable.forEach((p) => raw.push.apply(raw, p.list));
    const { courses, dropped } = normalizeCourses(raw);
    if (!courses.length) throw new Error('课程解析结果为空，未导入');

    const main = usable[0];
    const skipped = usable.reduce((s, p) => s + p.bad.length, 0) + dropped;
    let tip = '学期：' + term.label + '\n课程：' + courses.length + ' 条';
    if (skipped) tip += '（跳过 ' + skipped + ' 条异常）';
    if (main.slots && main.slots.length) tip += '\n作息：' + main.slots.length + ' 节';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    const info = await fetchSemesterInfo(main.cms);
    if (info) {
      try {
        await BP.saveCourseConfig(JSON.stringify(info));
      } catch (e) {
        configFailed = true;
      }
    }
    let slotsFailed = false;
    if (main.slots && main.slots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(main.slots));
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
      (skipped ? '，跳过 ' + skipped + ' 条异常记录' : '') +
      (configFailed ? '（校历未保存）' : '') +
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
