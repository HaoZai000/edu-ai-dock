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

  const ORIGIN = location.origin;
  const KB_URL = new URL('/InformationPortal/getKeBiao.php', ORIGIN).toString();

  // 用户提供的作息：上午 8:50 起课间 10 分钟，下午 14:00 起课间 20 分钟，晚上 19:00 起；单节 45 分钟
  const SLOT_CONFIG = {
    duration: 45,
    segments: [
      { first: 1, last: 4, start: '08:50', breakMin: 10 },
      { first: 5, last: 8, start: '14:00', breakMin: 20 },
      { first: 9, last: 10, start: '19:00', breakMin: 10 }
    ]
  };
  function buildTimeSlots() {
    const out = [];
    SLOT_CONFIG.segments.forEach(function (seg) {
      const parts = seg.start.split(':');
      let mins = (+parts[0]) * 60 + (+parts[1]);
      for (let n = seg.first; n <= seg.last; n++) {
        const s = mins;
        const e = mins + SLOT_CONFIG.duration;
        out.push({
          number: n,
          startTime: String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'),
          endTime: String(Math.floor(e / 60)).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0')
        });
        mins = e + seg.breakMin;
      }
    });
    return out;
  }

  function parseWeeks(raw) {
    if (!raw) return [];
    const set = {};
    String(raw).replace(/[（）()\s]/g, '').split(/[,，、;；]/).forEach(function (part) {
      if (!part) return;
      const onlyOdd = part.indexOf('单') >= 0;
      const onlyEven = part.indexOf('双') >= 0;
      const s = part.replace(/单|双|周/g, '');
      const m = s.match(/^(\d+)-(\d+)$/);
      const push = function (w) {
        if (w < 1 || w > 30) return;
        if (onlyOdd && w % 2 === 0) return;
        if (onlyEven && w % 2 === 1) return;
        set[w] = 1;
      };
      if (m) {
        let a = +m[1];
        let b = +m[2];
        if (a > b) { const t = a; a = b; b = t; }
        for (let i = a; i <= b; i++) push(i);
      } else if (/^\d+$/.test(s)) {
        push(+s);
      }
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  function cleanText(s) {
    return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseBlock(block) {
    const lines = block.split(/<br\s*\/?>/i).map(cleanText).filter(function (x) { return x.length > 0; });
    if (lines.length < 3) return null;
    const name = lines[0];
    let si = -1;
    let wi = -1;
    for (let i = 0; i < lines.length; i++) {
      if (si < 0 && /(\d+)\s*[-~—]\s*(\d+)\s*节/.test(lines[i])) si = i;
      if (wi < 0 && /周/.test(lines[i]) && /\d/.test(lines[i])) wi = i;
    }
    if (si < 0 || wi < 0) return null;
    const sm = lines[si].match(/(\d+)\s*[-~—]\s*(\d+)\s*节/);
    if (!sm) return null;
    let startSection = +sm[1];
    let endSection = +sm[2];
    if (startSection > endSection) { const t = startSection; startSection = endSection; endSection = t; }
    const weeks = parseWeeks(lines[wi]);
    if (!weeks.length) return null;
    let position = '';
    let teacher = '';
    const k = wi + 1;
    if (k < lines.length) position = lines[k];
    if (k + 1 < lines.length) teacher = lines[k + 1];
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(position) && !/[\dA-Za-z]/.test(position) && !teacher) {
      teacher = position;
      position = '';
    }
    return { name: name, position: position, teacher: teacher,
      startSection: startSection, endSection: endSection, weeks: weeks };
  }

  function parseCoursesFromDoc(doc) {
    const table = doc.querySelector('#table1');
    if (!table) throw new Error('课表表格 #table1 不存在');
    const rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
    const map = {};
    let invalid = 0;
    rows.forEach(function (tr, ri) {
      if (ri === 0) return;
      const cells = Array.prototype.slice.call(tr.cells || []);
      if (cells.length < 9) return;
      for (let d = 0; d < 7; d++) {
        const html = cells[d + 2].innerHTML;
        const blocks = html.split(/<br\s*\/?>\s*<br\s*\/?>/i);
        blocks.forEach(function (b) {
          if (!cleanText(b)) return;
          const c = parseBlock(b);
          if (!c) { invalid++; return; }
          c.day = d + 1;
          const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
          if (!map[key]) {
            map[key] = c;
          } else {
            const merged = map[key].weeks.concat(c.weeks);
            map[key].weeks = merged.filter(function (v, i, a) { return a.indexOf(v) === i; })
              .sort(function (a, b) { return a - b; });
          }
        });
      }
    });
    return { list: Object.keys(map).map(function (k) { return map[k]; }), invalid: invalid };
  }

  function groupOf(sec) { return sec <= 4 ? 'am' : (sec <= 8 ? 'pm' : 'night'); }

  function normalizeCourses(list) {
    const valid = [];
    let bad = 0;
    list.forEach(function (c) {
      const ok = c && typeof c.name === 'string' && c.name.length > 0 &&
        c.day >= 1 && c.day <= 7 &&
        Number.isInteger(c.startSection) && c.startSection >= 1 &&
        Number.isInteger(c.endSection) && c.endSection >= c.startSection &&
        Array.isArray(c.weeks) && c.weeks.length > 0 &&
        c.weeks.every(function (w) { return Number.isInteger(w) && w >= 1 && w <= 30; });
      if (ok) valid.push(c); else bad++;
    });
    let changed = true;
    while (changed) {
      changed = false;
      outer:
      for (let i = 0; i < valid.length; i++) {
        for (let j = i + 1; j < valid.length; j++) {
          const a = valid[i];
          const b = valid[j];
          if (a.name === b.name && a.teacher === b.teacher && a.position === b.position && a.day === b.day &&
              a.weeks.slice().sort().join(',') === b.weeks.slice().sort().join(',') &&
              a.endSection + 1 === b.startSection &&
              groupOf(a.startSection) === groupOf(b.startSection) &&
              (a.endSection - a.startSection) === (b.endSection - b.startSection)) {
            a.endSection = b.endSection;
            valid.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
    const map2 = {};
    valid.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!map2[key]) {
        map2[key] = c;
      } else {
        const w = map2[key].weeks.concat(c.weeks);
        map2[key].weeks = w.filter(function (v, i, arr) { return arr.indexOf(v) === i; })
          .sort(function (x, y) { return x - y; });
      }
    });
    return { courses: Object.keys(map2).map(function (k) { return map2[k]; }), invalid: bad };
  }

  async function fetchPage() {
    const res = await fetch(KB_URL, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('课表页请求失败 HTTP ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const selects = Array.prototype.slice.call(doc.querySelectorAll('select'));
    const options = [];
    let defaultIndex = 0;
    let selectedValue = '';
    for (let i = 0; i < selects.length; i++) {
      const s = selects[i];
      if (!/xnm|xqm|xnd|xqd|xnxq|term|semester/i.test(s.id + ' ' + s.name)) continue;
      const opts = Array.prototype.slice.call(s.options || []);
      if (!opts.length) continue;
      opts.forEach(function (o, ix) {
        options.push({ label: (o.text || o.value).trim(), value: o.value });
        if (o.selected) defaultIndex = ix;
      });
      selectedValue = s.value;
      break;
    }
    if (!options.length) {
      const m = (doc.body.textContent || '').match(/(\d{4}\s*[-—]\s*\d{4}\s*学年第\s*[12]\s*学期)/);
      const label = m ? m[1].replace(/\s+/g, '') : ((doc.title || '').replace(/课表查询/, '').trim() || '当前学期');
      options.push({ label: label, value: label });
      selectedValue = label;
    }
    return { options: options, defaultIndex: defaultIndex, selectedValue: selectedValue, doc: doc };
  }

  async function runImportFlow() {
    const ok = await alert('教务导入', '从学校信息门户读取整学期课表并导入，是否继续？', '开始导入');
    if (!ok) { toast('已取消导入'); return; }

    const meta = await fetchPage();
    let chosen = meta.options[meta.defaultIndex];
    if (meta.options.length > 1) {
      const idx = await select('选择学期', meta.options.map(function (o) { return o.label; }), meta.defaultIndex);
      if (idx === null) { toast('已取消导入'); return; }
      chosen = meta.options[idx];
    }
    // 页面只展示当前学期，切换学期请在页面上操作后再导入
    if (chosen.value !== meta.selectedValue && chosen.value !== chosen.label) {
      throw new Error('请先在页面上切换到「' + chosen.label + '」后再导入');
    }

    const parsed = parseCoursesFromDoc(meta.doc);
    const norm = normalizeCourses(parsed.list);
    if (!norm.courses.length) throw new Error('整学期课表解析后没有有效课程');

    await saveCourses(norm.courses);
    try { await BP.savePresetTimeSlots(JSON.stringify(buildTimeSlots())); } catch (e) {}
    toast('导入完成：共 ' + norm.courses.length + ' 条课程安排' +
      (norm.invalid ? '，跳过无效数据 ' + norm.invalid + ' 条' : ''));
    finish();
  }

  try {
    await runImportFlow();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
