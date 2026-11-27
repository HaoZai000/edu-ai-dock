// 河北地质大学华信学院（61.182.88.214:8090/jsxsd，青果 KINGOSOFT 教务）整学期课表适配器
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
  const toMin = (t) => { const p = String(t).split(':').map(Number); return p[0] * 60 + p[1]; };
  const toHM = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0');

  async function getText(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('请求失败(' + res.status + ')，请重新登录教务系统');
    const html = await res.text();
    if (!/kbtable|kbcontent|xnxq01id/.test(html) && /login|Logon/i.test(html)) {
      throw new Error('登录状态已失效，请重新登录教务系统');
    }
    return html;
  }

  function parseTerms(doc) {
    const sel = doc.querySelector('#xnxq01id');
    if (!sel) return { opts: [], def: 0 };
    const opts = [];
    let def = 0;
    Array.from(sel.options).forEach(function (o) {
      const value = (o.value || '').trim();
      if (!value) return;
      if (o.hasAttribute('selected')) def = opts.length;
      opts.push({ value: value, label: clean(o.textContent) || value });
    });
    return { opts: opts, def: Math.min(def, Math.max(opts.length - 1, 0)) };
  }

  function parseMode(doc) {
    const sel = doc.querySelector('#kbjcmsid');
    if (!sel || !sel.options.length) return '';
    const idx = sel.selectedIndex >= 0 ? sel.selectedIndex : 0;
    return (sel.options[idx] && sel.options[idx].value) || '';
  }

  function parseWeeks(text) {
    const t = String(text || '').replace(/\[[^\]]*\]/g, ' ');
    const odd = /单/.test(t);
    const even = /双/.test(t);
    const nums = new Set();
    t.replace(/(\d{1,2})\s*[-－–~至]\s*(\d{1,2})/g, function (m, a, b) {
      a = parseInt(a, 10); b = parseInt(b, 10);
      if (a > b) { const x = a; a = b; b = x; }
      for (let w = a; w <= b && w <= 30; w++) nums.add(w);
      return m;
    });
    t.replace(/(?:^|[^\d])(\d{1,2})(?![\d])/g, function (m, a) {
      const w = parseInt(a, 10);
      if (w >= 1 && w <= 30) nums.add(w);
      return m;
    });
    let arr = Array.from(nums).sort(function (a, b) { return a - b; });
    if (odd && !even) arr = arr.filter(function (w) { return w % 2 === 1; });
    if (even && !odd) arr = arr.filter(function (w) { return w % 2 === 0; });
    return arr;
  }

  function parseRowCourses(td, day, fallbackStart, fallbackEnd) {
    const out = [];
    const divs = Array.from(td.querySelectorAll('div.kbcontent'));
    const use = divs.length ? divs : Array.from(td.querySelectorAll('div.kbcontent1'));
    use.forEach(function (div) {
      const inner = String(div.innerHTML || '');
      for (const segHtml of inner.split(/-{5,}/)) {
        if (!/[^\s\u00a0]/.test(String(segHtml).replace(/<[^>]*>/g, ''))) continue;
        const segDoc = parseDoc('<div id="seg">' + segHtml + '</div>');
        const holder = segDoc.getElementById('seg');
        if (!holder) continue;

        let teacher = '';
        let room = '';
        let weekRaw = '';
        Array.from(holder.querySelectorAll('font[title]')).forEach(function (f) {
          const t = f.getAttribute('title') || '';
          const v = clean(f.textContent);
          if (t === '老师') teacher = v;
          else if (t.indexOf('周次') >= 0) weekRaw = v;
          else if (t === '教室') room = v;
        });
        if (!weekRaw) continue;

        const clone = holder.cloneNode(true);
        Array.from(clone.querySelectorAll('font')).forEach(function (f) { f.parentNode.removeChild(f); });
        const name = clean(clone.textContent).replace(/[\s\u00a0]+/g, '');
        if (!name) continue;

        const weeks = parseWeeks(weekRaw);
        if (!weeks.length) continue;

        const sec = weekRaw.match(/\[\s*(\d{1,2})\s*[-－–~至]\s*(\d{1,2})\s*节?\s*\]/);
        const one = weekRaw.match(/\[\s*(\d{1,2})\s*节?\s*\]/);
        let startSection = fallbackStart;
        let endSection = fallbackEnd;
        if (sec) {
          startSection = parseInt(sec[1], 10);
          endSection = parseInt(sec[2], 10);
        } else if (one) {
          startSection = parseInt(one[1], 10);
          endSection = startSection;
        }
        if (!(startSection >= 1 && endSection >= startSection)) continue;

        out.push({
          name: name, teacher: teacher, position: room, day: day,
          startSection: startSection, endSection: endSection, weeks: weeks
        });
      }
    });
    return out;
  }

  function fillSlots(map, startSection, endSection, t1, t2) {
    const n = endSection - startSection + 1;
    if (n <= 0) return;
    const start = toMin(t1);
    const end = toMin(t2);
    if (!(end > start)) return;
    const gap = n > 1 ? 10 : 0;
    let per = Math.round((end - start - gap * (n - 1)) / n);
    if (n > 1 && per < 25) per = Math.floor((end - start) / n);
    if (per <= 0) return;
    let cur = start;
    for (let k = 0; k < n; k++) {
      const num = startSection + k;
      if (!map[num]) map[num] = { number: num, startTime: toHM(cur), endTime: toHM(cur + per) };
      cur += per + gap;
    }
  }

  function parseTimetable(html) {
    const doc = parseDoc(html);
    const table = doc.querySelector('#kbtable');
    if (!table) throw new Error('未找到课表表格，请确认已进入「学期理论课表」');
    const rows = Array.from(table.querySelectorAll('tr'));
    const list = [];
    const slotMap = {};
    let rowOrdinal = 0;

    rows.forEach(function (tr) {
      const th = tr.querySelector('th');
      const tds = Array.from(tr.children).filter(function (el) { return el.tagName === 'TD'; });
      if (!th || tds.length < 7) return;
      const thText = clean(th.textContent);
      const tm = thText.match(/(\d{1,2}:\d{2})\s*[-－–~至]\s*(\d{1,2}:\d{2})/);
      if (!tm) return;
      const fbStart = rowOrdinal * 2 + 1;
      const fbEnd = fbStart + 1;
      rowOrdinal++;

      let rowStart = 0;
      let rowEnd = 0;
      tds.slice(-7).forEach(function (td, idx) {
        const courses = parseRowCourses(td, idx + 1, fbStart, fbEnd);
        courses.forEach(function (c) {
          if (!rowStart || c.startSection < rowStart) rowStart = c.startSection;
          if (!rowEnd || c.endSection > rowEnd) rowEnd = c.endSection;
          list.push(c);
        });
      });
      if (rowStart && rowEnd) fillSlots(slotMap, rowStart, rowEnd, tm[1], tm[2]);
    });

    return { list: list, slots: Object.keys(slotMap).map(function (k) { return slotMap[k]; })
      .sort(function (a, b) { return a.number - b.number; }) };
  }

  function normalizeCourses(list) {
    const valid = [];
    let bad = 0;
    list.forEach(function (c) {
      if (!c || !c.name || !(c.day >= 1 && c.day <= 7) ||
          !(c.startSection >= 1 && c.endSection >= c.startSection) ||
          !c.weeks || !c.weeks.length) { bad++; return; }
      valid.push(c);
    });

    const sameWeeks = function (a, b) {
      return a.length === b.length && a.every(function (w, i) { return w === b[i]; });
    };

    const step1 = [];
    valid.forEach(function (c) {
      const hit = step1.find(function (x) {
        return x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
          x.day === c.day && sameWeeks(x.weeks, c.weeks) && c.startSection === x.endSection + 1;
      });
      if (hit) hit.endSection = c.endSection;
      else step1.push(c);
    });

    const step2 = [];
    step1.forEach(function (c) {
      const hit = step2.find(function (x) {
        return x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
          x.day === c.day && x.startSection === c.startSection && x.endSection === c.endSection;
      });
      if (hit) hit.weeks = Array.from(new Set(hit.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      else step2.push(c);
    });
    return { courses: step2, bad: bad };
  }

  async function runImportFlow() {
    const first = await getText(BASE + '/xskb/xskb_list.do');
    const firstDoc = parseDoc(first);
    const terms = parseTerms(firstDoc);
    if (!terms.opts.length) throw new Error('课表页没有解析到学年学期下拉框，请进入「学期理论课表」后重试');
    const mode = parseMode(firstDoc);

    let term = terms.opts[0];
    if (terms.opts.length > 1) {
      const picked = await select('选择学年学期', terms.opts.map(function (o) { return o.label; }), terms.def);
      if (picked === null || picked === undefined || Number(picked) === -1) { toast('已取消，未导入'); return; }
      const i = Number(picked);
      if (!Number.isInteger(i) || i < 0 || !terms.opts[i]) { toast('已取消，未导入'); return; }
      term = terms.opts[i];
    }

    toast('正在读取课表…');
    const url = BASE + '/xskb/xskb_list.do?xnxq01id=' + encodeURIComponent(term.value) +
      '&zc=' + (mode ? '&kbjcmsid=' + encodeURIComponent(mode) : '');
    const html = await getText(url);
    const doc = parseDoc(html);
    const sel2 = doc.querySelector('#xnxq01id');
    if (!sel2) throw new Error('切换学期后页面结构异常，可能已退出登录');

    const parsed = parseTimetable(html);
    const result = normalizeCourses(parsed.list);
    if (!result.courses.length) throw new Error('该学期未解析到课程，可能课表未排定');

    const names = Array.from(new Set(result.courses.map(function (c) { return c.name; })));
    let tip = '学期：' + term.label + '\n课程：' + names.length + ' 门（' + result.courses.length + ' 条安排）';
    if (result.bad) tip += '\n跳过异常：' + result.bad + ' 条';
    if (parsed.slots.length) tip += '\n作息：' + parsed.slots.length + ' 节';
    const ok = await alert('确认导入', tip + '\n\n导入会覆盖当前课表。', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(result.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let slotsFailed = false;
    if (parsed.slots.length) {
      try {
        if (typeof BP.savePresetTimeSlots === 'function') {
          const r = await BP.savePresetTimeSlots(JSON.stringify(parsed.slots));
          if (r === false || r === 'false' || r === null) slotsFailed = true;
        }
      } catch (e) { slotsFailed = true; }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + names.length + ' 门课程（' + result.courses.length + ' 条安排）' +
      (result.bad ? '，跳过 ' + result.bad + ' 条异常' : '') +
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
