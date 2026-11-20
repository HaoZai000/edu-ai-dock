(async function main() {
  const PAGE_PATH = '/JmptJwxt/JwStd000201011';

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

  async function fetchPageHtml() {
    const url = new URL(PAGE_PATH, location.origin).href;
    const resp = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!resp.ok) throw new Error('课表页面请求失败(' + resp.status + ')');
    const buf = await resp.arrayBuffer();
    return new TextDecoder('gbk').decode(buf);
  }

  function dayToNumber(text) {
    const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
    const m = String(text).match(/[一二三四五六日天]/);
    return m ? map[m[0]] : 0;
  }

  function expandWeeks(s) {
    if (!s) return [];
    const text = String(s).replace(/[周\s]/g, '').replace(/[()（）]/g, '');
    const out = new Set();
    text.split(/[,，、;；]/).forEach(function (piece) {
      let p = piece.trim().replace(/^第/, '');
      if (!p) return;
      let parity = 0;
      if (p.indexOf('单') >= 0) { parity = 1; p = p.replace(/单/g, ''); }
      else if (p.indexOf('双') >= 0) { parity = 2; p = p.replace(/双/g, ''); }
      const m = p.match(/^(\d+)\s*[-~至到]\s*(\d+)$/);
      let a;
      let b;
      if (m) {
        a = parseInt(m[1], 10);
        b = parseInt(m[2], 10);
      } else if (/^\d+$/.test(p)) {
        a = b = parseInt(p, 10);
      } else {
        return;
      }
      if (!(a >= 1 && b >= a) || a > 30) return;
      b = Math.min(b, 30);
      for (let w = a; w <= b; w++) {
        if (parity === 1 && w % 2 === 0) continue;
        if (parity === 2 && w % 2 === 1) continue;
        out.add(w);
      }
    });
    return Array.from(out).sort(function (a, b) { return a - b; });
  }

  function findCourseTable(doc) {
    const tables = doc.querySelectorAll('table');
    for (const t of tables) {
      const head = Array.from(t.querySelectorAll('th')).map(function (x) { return x.textContent.trim(); }).join('');
      if (head.indexOf('课程名称') >= 0 && head.indexOf('开始节') >= 0) return t;
    }
    return null;
  }

  function parseCourses(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = findCourseTable(doc);
    if (!table) return [];
    const list = [];
    let currentDay = 0;
    for (const tr of table.querySelectorAll('tr')) {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (!tds.length) continue;
      const firstText = tds[0].textContent.trim();
      let cells;
      if (/^(星期|周)?[一二三四五六日天]$/.test(firstText)) {
        currentDay = dayToNumber(firstText);
        cells = tds.slice(1);
      } else {
        cells = tds;
      }
      if (cells.length < 4 || !currentDay) continue;
      const x = cells.map(function (td) { return td.textContent.trim(); });
      const name = x[3];
      if (!name) continue;
      const startSection = parseInt(x[1], 10);
      const endSection = parseInt(x[2], 10);
      let weeks = expandWeeks(x[0]);
      const parityText = x[8] || '';
      if (parityText.indexOf('单') >= 0) weeks = weeks.filter(function (w) { return w % 2 === 1; });
      else if (parityText.indexOf('双') >= 0) weeks = weeks.filter(function (w) { return w % 2 === 0; });
      if (!(startSection >= 1 && endSection >= startSection && endSection <= 30 && weeks.length)) continue;
      list.push({
        name: name,
        teacher: x[5] || '',
        position: x[6] || '',
        day: currentDay,
        startSection: startSection,
        endSection: endSection,
        weeks: weeks
      });
    }
    return list;
  }

  function parseTimeSlots(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = doc.body ? doc.body.textContent : '';
    const re = /第\s*(\d+)\s*节\s*[:：]?\s*(\d{1,2}:\d{2})\s*[-~－—]\s*(\d{1,2}:\d{2})/g;
    const map = new Map();
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 30 && !map.has(n)) {
        map.set(n, { number: n, startTime: m[2], endTime: m[3] });
      }
    }
    return Array.from(map.values()).sort(function (a, b) { return a.number - b.number; });
  }

  function fetchAcademicOptions(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const options = [];
    let defaultIndex = 0;
    for (const sel of doc.querySelectorAll('select')) {
      const key = ((sel.id || '') + ' ' + (sel.name || '')).toLowerCase();
      if (/xnm|xqm|xnd|xqd|xnxq|term/.test(key)) {
        Array.from(sel.querySelectorAll('option')).forEach(function (o) {
          const value = String(o.value || '').trim();
          if (!value) return;
          options.push({ label: o.textContent.trim(), value: value });
          if (o.selected) defaultIndex = options.length - 1;
        });
        if (options.length) break;
      }
    }
    if (!options.length) {
      const hidden = doc.querySelector('input[name="Xq"]');
      const val = hidden ? String(hidden.value || '').trim() : '';
      if (val) options.push({ label: val, value: val });
    }
    return { options: options, defaultIndex: defaultIndex };
  }

  function normalizeCourses(list) {
    const valid = [];
    let skipped = 0;
    list.forEach(function (c) {
      const weeks = (c.weeks || []).filter(function (n) { return isFinite(n) && n >= 1 && n <= 30; });
      if (!c.name || !(c.day >= 1 && c.day <= 7) ||
          !isFinite(c.startSection) || !isFinite(c.endSection) ||
          c.startSection < 1 || c.endSection < c.startSection || c.endSection > 30 ||
          !weeks.length) {
        skipped++;
        return;
      }
      valid.push({
        name: String(c.name), teacher: c.teacher || '', position: c.position || '',
        day: c.day, startSection: c.startSection, endSection: c.endSection,
        weeks: Array.from(new Set(weeks)).sort(function (a, b) { return a - b; })
      });
    });

    valid.sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });

    const idKey = function (c) { return [c.name, c.teacher, c.position, c.day].join('|'); };
    const wkKey = function (c) { return c.weeks.join(','); };
    const stage1 = [];
    valid.forEach(function (c) {
      let hit = null;
      for (const m of stage1) {
        if (idKey(m) === idKey(c) && wkKey(m) === wkKey(c) && m.endSection + 1 === c.startSection) {
          hit = m;
          break;
        }
      }
      if (hit) {
        hit.endSection = c.endSection;
      } else {
        stage1.push({
          name: c.name, teacher: c.teacher, position: c.position, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
        });
      }
    });

    const result = [];
    const secKey = function (c) {
      return [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
    };
    stage1.forEach(function (c) {
      let hit = null;
      for (const r of result) {
        if (secKey(r) === secKey(c)) { hit = r; break; }
      }
      if (hit) {
        hit.weeks = Array.from(new Set(hit.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      } else {
        result.push({
          name: c.name, teacher: c.teacher, position: c.position, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
        });
      }
    });
    return { courses: result, skipped: skipped };
  }

  async function runImportFlow() {
    const go = await alert('课表导入', '将读取当前学期整学期课表并导入，是否继续？', '继续');
    if (!go) {
      toast('已取消，未导入');
      return;
    }

    const html = await fetchPageHtml();
    const aca = fetchAcademicOptions(html);
    if (!aca.options.length) throw new Error('页面上没有找到学期信息，请重新登录后重试');
    const idx = await choose('选择学期', aca.options.map(function (o) { return o.label; }), aca.defaultIndex);
    if (idx < 0) {
      toast('已取消，未导入');
      return;
    }
    const semester = aca.options[idx];

    const rawCourses = parseCourses(html);
    const slots = parseTimeSlots(html);
    const norm = normalizeCourses(rawCourses);
    if (!norm.courses.length) throw new Error('课表页面没有解析到课程');

    const confirmed = await alert(
      '确认导入',
      '学期：' + semester.label +
        '\n课程：' + norm.courses.length + ' 门' +
        (norm.skipped > 0 ? '（跳过异常 ' + norm.skipped + ' 条）' : '') +
        '\n作息：' + (slots.length ? slots.length + ' 节' : '未取到') +
        '\n\n导入会覆盖当前课表。',
      '导入'
    );
    if (!confirmed) {
      toast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(norm.courses));
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
    toast('导入完成：' + norm.courses.length + ' 门课' +
      (norm.skipped > 0 ? '，跳过 ' + norm.skipped + ' 条异常' : '') +
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
