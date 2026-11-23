// 山西师范大学（jwxt.sxnu.edu.cn，金智 jsxsd）整学期课表适配器
(async function main() {
  const KB_PATH = '/jsxsd/xskb/xskb_list.do';
  const BASES = [location.origin];
  // 校园网内可能是内网地址，公网入口作为兜底
  if (location.origin.indexOf('jwxt.sxnu.edu.cn') < 0) BASES.push('https://jwxt.sxnu.edu.cn');

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

  function toMin(t) { const p = String(t).split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
  function fmt(m) {
    const h = Math.floor(m / 60), mi = m % 60;
    return (h < 10 ? '0' + h : '' + h) + ':' + (mi < 10 ? '0' + mi : '' + mi);
  }
  function clean(s) { return (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* ---------- 取数 ---------- */
  async function getDoc(url) {
    const res = await fetch(url, { credentials: 'include', headers: { 'Accept': 'text/html' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc.querySelector('#xnxq01id')) {
      if (!doc.querySelector('#timetable')) throw new Error('登录状态已失效或不在课表页面，请重新登录教务系统');
      throw new Error('未找到学年学期下拉框');
    }
    return doc;
  }

  async function fetchAcademicOptions() {
    let lastErr = null;
    for (let i = 0; i < BASES.length; i++) {
      try {
        const doc = await getDoc(BASES[i] + KB_PATH);
        const sel = doc.querySelector('#xnxq01id');
        const opts = [];
        let defIdx = 0;
        const list = sel.options;
        for (let k = 0; k < list.length; k++) {
          const o = list[k];
          if (!o.value) continue;
          opts.push({ text: clean(o.textContent), value: o.value });
          if (o.hasAttribute && o.hasAttribute('selected')) defIdx = opts.length - 1;
        }
        if (!opts.length) throw new Error('学年学期下拉框为空');
        const jm = doc.querySelector('#kbjcmsid');
        return { base: BASES[i], options: opts, defIdx: defIdx, jcms: jm ? jm.value : '' };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('无法访问教务课表页面');
  }

  async function chooseSemester(opt) {
    let pick;
    // 只有一个学年学期时直接使用，避免多余的选择交互
    if (opt.options.length === 1) {
      pick = opt.options[0];
    } else {
      const idx = await select('选择要导入的学年学期', opt.options.map(function (o) { return o.text; }), opt.defIdx);
      if (idx === null || idx === undefined || Number(idx) < 0 || !opt.options[Number(idx)]) return null;
      pick = opt.options[Number(idx)];
    }
    let url = opt.base + KB_PATH + '?xnxq01id=' + encodeURIComponent(pick.value);
    if (opt.jcms) url += '&kbjcmsid=' + encodeURIComponent(opt.jcms);
    const doc = await getDoc(url);
    const sel = doc.querySelector('#xnxq01id');
    let now = '';
    if (sel) {
      if (sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) now = sel.options[sel.selectedIndex].value;
      else if (sel.querySelector('option[selected]')) now = sel.querySelector('option[selected]').value;
    }
    // 切换失败时不要拿旧课表继续导入
    if (now && now !== pick.value) throw new Error('切换学年学期失败（当前为 ' + now + '），请重试');
    return { doc: doc, label: pick.text };
  }

  /* ---------- 节次作息（接口里读） ---------- */
  function fetchTimeSlots(doc) {
    const table = doc.querySelector('#timetable');
    if (!table) return { slots: [], rows: [] };
    const trs = table.querySelectorAll('tr');
    const rows = [];
    for (let i = 0; i < trs.length; i++) {
      const tr = trs[i];
      const th = tr.children[0];
      if (!th) continue;
      const txt = clean(th.textContent);
      const jm = txt.match(/\(([^)]*)小节\)/);
      const tm = txt.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      if (!jm || !tm) continue;
      const secs = jm[1].split(',').map(function (s) { return parseInt(s.trim(), 10); })
        .filter(function (n) { return !isNaN(n) && n > 0; });
      if (!secs.length) continue;
      rows.push({ secs: secs, start: tm[1], end: tm[2] });
    }
    const slots = [];
    rows.forEach(function (r) {
      const s = toMin(r.start), total = toMin(r.end) - s, n = r.secs.length;
      let per = Math.round((total - (n - 1) * 5) / n);
      if (per < 25 || per > 60) per = Math.round(total / n);
      let cur = s;
      for (let i = 0; i < n; i++) {
        slots.push({ number: r.secs[i], startTime: fmt(cur), endTime: fmt(cur + per) });
        cur += per + 5;
      }
    });
    slots.sort(function (a, b) { return a.number - b.number; });
    return { slots: slots, rows: rows };
  }

  /* ---------- 周次解析 ---------- */
  function parseWeeks(text) {
    let body = String(text || '').split('[')[0];
    // 保留单双周标记，只清掉其它括号内容
    body = body.replace(/\((?!单|双)[^)]*\)/g, ' ');
    const set = new Set();
    body.split(/[,，;；]/).forEach(function (part) {
      const p = part.replace(/[()]/g, '').replace(/周/g, '').trim();
      if (!p) return;
      const odd = /单/.test(p), even = /双/.test(p);
      const push = function (w) {
        if (w < 1 || w > 30) return;
        if (odd && w % 2 === 0) return;
        if (even && w % 2 === 1) return;
        set.add(w);
      };
      const rg = p.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (rg) {
        const a = parseInt(rg[1], 10), b = parseInt(rg[2], 10);
        if (!isNaN(a) && !isNaN(b) && b >= a) for (let w = a; w <= b && w <= 30; w++) push(w);
      } else {
        const sg = p.match(/^(\d+)$/);
        if (sg) push(parseInt(sg[1], 10));
      }
    });
    return Array.from(set).sort(function (a, b) { return a - b; });
  }

  function parseSectionRange(text, rowSecs) {
    const m = String(text || '').match(/\[([\d\-]+)节\]/);
    let nums = [];
    if (m) {
      nums = m[1].split('-').map(function (s) { return parseInt(s, 10); }).filter(function (n) { return !isNaN(n); });
    } else if (rowSecs && rowSecs.length) {
      nums = rowSecs.slice();
    }
    if (!nums.length) return null;
    return { start: Math.min.apply(null, nums), end: Math.max.apply(null, nums) };
  }

  /* ---------- 课程解析 ---------- */
  function parseCourses(doc) {
    const table = doc.querySelector('#timetable');
    const out = [];
    if (!table) return out;
    const trs = table.querySelectorAll('tr');
    for (let r = 0; r < trs.length; r++) {
      const tr = trs[r];
      const th = tr.children[0];
      if (!th) continue;
      const htxt = clean(th.textContent);
      if (htxt.indexOf('备注') >= 0) continue;
      const jm = htxt.match(/\(([^)]*)小节\)/);
      if (!jm) continue;
      const rowSecs = jm[1].split(',').map(function (s) { return parseInt(s.trim(), 10); })
        .filter(function (n) { return !isNaN(n) && n > 0; });
      if (!rowSecs.length) continue;
      for (let c = 1; c < tr.children.length && c <= 7; c++) {
        const td = tr.children[c];
        const day = c;
        let boxes = [];
        const divs = td.querySelectorAll('div.kbcontent, div.kbcontent1');
        for (let d = 0; d < divs.length; d++) {
          if (/-2$/.test(divs[d].id || '')) boxes.push(divs[d]);
        }
        if (!boxes.length) {
          for (let d = 0; d < divs.length; d++) {
            if (!/-4$/.test(divs[d].id || '')) boxes.push(divs[d]);
          }
        }
        for (let bi = 0; bi < boxes.length; bi++) {
          const blocks = boxes[bi].innerHTML.split(/-{5,}/);
          for (let bk = 0; bk < blocks.length; bk++) {
            const frag = new DOMParser().parseFromString('<div>' + blocks[bk] + '</div>', 'text/html');
            const fonts = frag.querySelectorAll('font');
            let name = '', teacher = '', room = '', wkText = '';
            for (let f = 0; f < fonts.length; f++) {
              const fo = fonts[f];
              const t = clean(fo.textContent);
              const title = fo.getAttribute('title') || '';
              const nm = fo.getAttribute('name') || '';
              if (!t) continue;
              if (title === '教师') { teacher = t; continue; }
              if (title === '教室') { room = t; continue; }
              if (title.indexOf('周次') >= 0) { wkText = t; continue; }
              if (nm === 'tzdbh' || nm === 'jxlmc' || nm === 'wkxx' || nm === 'ktmcstr' ||
                  nm === 'bzstr' || nm === 'xsks') continue;
              if (t.indexOf('通知单编号') === 0 || t.indexOf('班级：') === 0 ||
                  t.indexOf('备注：') === 0 || t.indexOf('(') === 0) continue;
              if (!name) name = t;
            }
            if (!name || !wkText) continue;
            const weeks = parseWeeks(wkText);
            const sec = parseSectionRange(wkText, rowSecs);
            if (!weeks.length || !sec) continue;
            out.push({
              name: name, teacher: teacher, position: room,
              day: day, startSection: sec.start, endSection: sec.end, weeks: weeks
            });
          }
        }
      }
    }
    return out;
  }

  /* ---------- 校验 + 合并 ---------- */
  function normalizeCourses(list) {
    const ok = [];
    let bad = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.name) { bad++; continue; }
      if (!(c.day >= 1 && c.day <= 7)) { bad++; continue; }
      if (!(c.startSection >= 1 && c.endSection >= c.startSection)) { bad++; continue; }
      if (!c.weeks || !c.weeks.length) { bad++; continue; }
      ok.push({
        name: c.name, teacher: c.teacher || '', position: c.position || '',
        day: c.day, startSection: c.startSection, endSection: c.endSection,
        weeks: c.weeks.slice().sort(function (a, b) { return a - b; })
      });
    }
    // 同课同周次 + 节次连续 → 合并节次；同课同节次 → 周次取并集
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < ok.length && !merged; i++) {
        for (let j = i + 1; j < ok.length; j++) {
          const a = ok[i], b = ok[j];
          if (a.name !== b.name || a.teacher !== b.teacher || a.position !== b.position || a.day !== b.day) continue;
          const sameWeeks = a.weeks.join(',') === b.weeks.join(',');
          if (sameWeeks && (a.endSection + 1 === b.startSection || b.endSection + 1 === a.startSection)) {
            a.startSection = Math.min(a.startSection, b.startSection);
            a.endSection = Math.max(a.endSection, b.endSection);
            ok.splice(j, 1); merged = true; break;
          }
          if (a.startSection === b.startSection && a.endSection === b.endSection) {
            const u = {};
            a.weeks.concat(b.weeks).forEach(function (w) { u[w] = 1; });
            a.weeks = Object.keys(u).map(Number).sort(function (x, y) { return x - y; });
            ok.splice(j, 1); merged = true; break;
          }
        }
      }
    }
    return { courses: ok, skipped: bad };
  }

  /* ---------- 主流程 ---------- */
  async function runImportFlow() {
    const opt = await fetchAcademicOptions();
    const picked = await chooseSemester(opt);
    if (!picked) { toast('已取消，未导入'); return; }

    const ts = fetchTimeSlots(picked.doc);
    const res = normalizeCourses(parseCourses(picked.doc));
    if (!res.courses.length) throw new Error('没有解析到任何课程，请确认该学年学期已有课表数据');

    let maxWeek = 0;
    res.courses.forEach(function (c) {
      c.weeks.forEach(function (w) { if (w > maxWeek) maxWeek = w; });
    });
    let tip = '学期：' + picked.label + '\n课程：' + res.courses.length + ' 条';
    if (res.skipped) tip += '（跳过 ' + res.skipped + ' 条不完整记录）';
    if (maxWeek > 0) tip += '\n教学周：' + maxWeek + ' 周';
    if (ts.slots.length) tip += '\n作息：' + ts.slots.length + ' 节';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(res.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    const cfg = {};
    if (maxWeek > 0) cfg.semesterTotalWeeks = maxWeek;
    if (ts.slots.length) {
      const first = ts.slots[0];
      const dm = toMin(first.endTime) - toMin(first.startTime);
      if (dm > 0) cfg.defaultClassDuration = dm;
      if (ts.slots.length > 1) {
        const br = toMin(ts.slots[1].startTime) - toMin(first.endTime);
        if (br > 0) cfg.defaultBreakDuration = br;
      }
    }
    if (Object.keys(cfg).length) {
      try {
        await BP.saveCourseConfig(JSON.stringify(cfg));
      } catch (e) {
        configFailed = true;
      }
    }
    let slotsFailed = false;
    if (ts.slots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(ts.slots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + res.courses.length + ' 条课程' +
      (res.skipped ? '，跳过 ' + res.skipped + ' 条不完整记录' : '') +
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
