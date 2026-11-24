// 湖南工程学院（金智教务）整学期课表适配器
(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BD = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  const ORIGIN = location.origin;
  const QUERY_PATH = '/jsxsd/xskb/xskb_list.do';
  const HOME_PATH = '/jsxsd/framework/xsMainV_new.htmlx?t1=1';
  const KB_PATH = '/jsxsd/framework/mainV_index_loadkb.htmlx';

  function toast(msg) {
    if (BD && typeof BD.showToast === 'function') { try { BD.showToast(msg); return; } catch (e) {} }
    if (BP && typeof BP.showToast === 'function') { try { BP.showToast(msg); } catch (e) {} }
  }

  async function alert(title, content, confirmText) {
    if (!BP || typeof BP.showAlert !== 'function') return true;
    return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
  }

  async function choose(title, labels, def) {
    if (labels.length === 1) return 0;
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    const d = Math.max(0, Math.min(Number(def) || 0, labels.length - 1));
    const r = await BP.showSingleSelection(title, JSON.stringify(labels), d);
    if (r === null || r === undefined) return -1;
    const n = Number(r);
    return Number.isInteger(n) && n >= 0 && n < labels.length ? n : -1;
  }

  function parseOptions(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sel = doc.querySelector('#xnxq01id');
    const opts = [];
    let def = 0;
    if (sel) {
      Array.from(sel.options).forEach(function (o, i) {
        opts.push({ value: o.value, text: (o.textContent || '').trim() || o.value });
        if (o.selected) def = i;
      });
    }
    const kbSel = doc.querySelector('#kbjcmsid');
    let sjms = '';
    if (kbSel && kbSel.options.length) {
      const idx = kbSel.selectedIndex >= 0 ? kbSel.selectedIndex : 0;
      sjms = kbSel.options[idx].value || '';
    }
    return { opts: opts, def: def, sjms: sjms };
  }

  function parseCalendar(html) {
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sel = doc.querySelector('#week');
    if (!sel) return null;
    const dates = Array.from(sel.options)
      .map(function (o) { return (o.value || '').trim(); })
      .filter(function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); });
    if (!dates.length) return null;
    return { semesterStartDate: dates[0], semesterTotalWeeks: dates.length };
  }

  function parseWeeks(text) {
    const m = String(text || '').match(/第([^周]+)周/);
    if (!m) return [];
    const body = m[1];
    const set = {};
    body.split(',').forEach(function (part) {
      const p = part.trim();
      const range = p.match(/^(\d+)\s*[-~～]\s*(\d+)$/);
      if (range) {
        const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
        const lo = Math.max(1, Math.min(a, b));
        const hi = Math.min(30, Math.max(a, b));
        for (let i = lo; i <= hi; i++) set[i] = 1;
      } else if (/^\d+$/.test(p)) {
        const w = parseInt(p, 10);
        if (w >= 1 && w <= 30) set[w] = 1;
      }
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  function parseTimetable(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#timetable');
    if (!table) return [];
    const tbody = table.querySelector('tbody') || table;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const out = [];
    rows.forEach(function (tr) {
      const cells = Array.from(tr.children).filter(function (el) {
        return el.tagName === 'TD' || el.tagName === 'TH';
      });
      if (cells.length < 8) return;
      for (let i = 1; i <= 7; i++) {
        const td = cells[i];
        if (!td) continue;
        const boxes = Array.from(td.querySelectorAll('div.item-box'));
        boxes.forEach(function (box) {
          let cur = null;
          Array.from(box.children).forEach(function (el) {
            const tag = el.tagName;
            const cls = ' ' + (el.className || '') + ' ';
            if (tag === 'P') {
              const nm = (el.textContent || '').trim();
              if (!nm) { cur = null; return; }
              cur = { name: nm, teacher: '', position: '', sectionText: '', weekText: '', day: i };
              out.push(cur);
            } else if (cur && cls.indexOf(' tch-name ') >= 0) {
              Array.from(el.querySelectorAll('span')).forEach(function (sp) {
                const t = (sp.textContent || '').trim();
                if (/^教师[:：]/.test(t)) cur.teacher = t.replace(/^教师[:：]\s*/, '');
                else if (/\d+\s*[~～-]\s*\d+\s*节/.test(t)) cur.sectionText = t;
              });
            } else if (cur && tag === 'DIV' && cls.indexOf(' item-box ') < 0 && cls.indexOf(' tch-name ') < 0) {
              const spans = Array.from(el.querySelectorAll('span'));
              if (spans.length > 0) {
                let pos = (spans[0].textContent || '').trim();
                if (pos === '-') pos = '';
                cur.position = pos;
              }
              if (spans.length > 1) cur.weekText = (spans[1].textContent || '').trim();
              else cur.weekText = (el.textContent || '').trim();
            }
          });
        });
      }
    });
    return out;
  }

  function rawToCourses(raw) {
    return raw.map(function (c) {
      const sm = (c.sectionText || '').match(/(\d+)\s*[~～-]\s*(\d+)/);
      return {
        name: c.name,
        teacher: c.teacher || '',
        position: c.position || '',
        day: c.day,
        startSection: sm ? parseInt(sm[1], 10) : NaN,
        endSection: sm ? parseInt(sm[2], 10) : NaN,
        weeks: parseWeeks(c.weekText)
      };
    });
  }

  function keyOf(c, withWeeks) {
    const base = [c.name, c.teacher, c.position, c.day].join('|');
    if (withWeeks) return base + '|w=' + c.weeks.slice().sort(function (a, b) { return a - b; }).join(',');
    return base + '|s=' + c.startSection + '-' + c.endSection;
  }

  function normalizeCourses(list) {
    const valid = [];
    let skipped = 0;
    list.forEach(function (c) {
      if (c.name && c.day >= 1 && c.day <= 7 && c.startSection >= 1 && c.endSection >= c.startSection && c.weeks.length > 0) valid.push(c);
      else skipped++;
    });
    const g1 = {};
    valid.forEach(function (c) { const k = keyOf(c, true); (g1[k] = g1[k] || []).push(c); });
    const after1 = [];
    Object.keys(g1).forEach(function (k) {
      const arr = g1[k].slice().sort(function (a, b) { return a.startSection - b.startSection; });
      const merged = [];
      arr.forEach(function (c) {
        const last = merged[merged.length - 1];
        if (last && last.endSection + 1 === c.startSection) last.endSection = c.endSection;
        else merged.push({ name: c.name, teacher: c.teacher, position: c.position, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice() });
      });
      after1.push.apply(after1, merged);
    });
    const g2 = {};
    after1.forEach(function (c) { const k = keyOf(c, false); (g2[k] = g2[k] || []).push(c); });
    const final = [];
    Object.keys(g2).forEach(function (k) {
      const arr = g2[k];
      const base = { name: arr[0].name, teacher: arr[0].teacher, position: arr[0].position,
        day: arr[0].day, startSection: arr[0].startSection, endSection: arr[0].endSection };
      const set = {};
      arr.forEach(function (c) { c.weeks.forEach(function (w) { set[w] = 1; }); });
      base.weeks = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
      final.push(base);
    });
    return { courses: final, skipped: skipped };
  }

  async function runImportFlow() {
    const qRes = await fetch(ORIGIN + QUERY_PATH, { credentials: 'same-origin' });
    if (!qRes.ok) throw new Error('课表查询页请求失败 ' + qRes.status);
    const info = parseOptions(await qRes.text());
    if (!info.opts.length) throw new Error('未找到学年学期选项');

    const idx = await choose('选择学年学期', info.opts.map(function (o) { return o.text; }), info.def);
    if (idx < 0) { toast('已取消，未导入'); return; }
    const sem = info.opts[idx];

    toast('正在读取课表…');
    const kbUrl = ORIGIN + KB_PATH + '?rq=all'
      + '&sjmsValue=' + encodeURIComponent(info.sjms)
      + '&xnxqid=' + encodeURIComponent(sem.value)
      + '&xswk=false';
    const pair = await Promise.all([
      fetch(kbUrl, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('课表请求失败 ' + r.status);
        return r.text();
      }),
      fetch(ORIGIN + HOME_PATH, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; })
    ]);

    const raw = parseTimetable(pair[0]);
    if (!raw.length) throw new Error('课表为空，可能学期选择有误');
    const result = normalizeCourses(rawToCourses(raw));
    if (!result.courses.length) throw new Error('没有有效的课程数据');

    const cal = parseCalendar(pair[1]);
    let tip = '学期：' + sem.text + '\n课程：' + result.courses.length + ' 条';
    if (result.skipped) tip += '\n跳过：' + result.skipped + ' 条';
    if (cal) tip += '\n教学周：' + cal.semesterTotalWeeks + ' 周';
    const ok = await alert('确认导入', tip + '\n\n导入会覆盖当前课表。', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(result.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    if (cal) {
      try {
        await BP.saveCourseConfig(JSON.stringify({
          semesterStartDate: cal.semesterStartDate,
          semesterTotalWeeks: cal.semesterTotalWeeks
        }));
      } catch (e) {
        configFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + result.courses.length + ' 条课程' +
      (result.skipped ? '，跳过 ' + result.skipped + ' 条异常' : '') +
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
