// 辽宁中医药大学杏林学院教务系统（tmweb_xl）整学期课表适配器
(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;

  function toast(msg) {
    const b = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;
    if (b && typeof b.showToast === 'function') {
      try { b.showToast(msg); } catch (e) {}
      return;
    }
    if (BP && typeof BP.showToast === 'function') {
      try { BP.showToast(msg); } catch (e) {}
    }
  }

  async function alert(title, content, confirmText) {
    if (!BP || typeof BP.showAlert !== 'function') return true;
    return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
  }

  async function select(title, labels, def) {
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    return await BP.showSingleSelection(title, JSON.stringify(labels), def);
  }

  async function saveOk(name, payload) {
    if (!BP || typeof BP[name] !== 'function') throw new Error('桥未就绪，请重试');
    const r = await BP[name](payload);
    return !(r === false || r === 'false' || r === null);
  }

  async function notifyTaskCompletion() {
    const b = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;
    if (b && typeof b.notifyTaskCompletion === 'function') {
      try { b.notifyTaskCompletion(); } catch (e) {}
      return;
    }
    if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
  }

  const TERM_PAGE = location.origin + '/tmweb_xl/TimetableSearch/TimetableSerachStudentSingleSpan.aspx';

  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  }

  function cleanName(s) {
    return String(s || '').replace(/\[[^\]]*\]\s*$/, '').replace(/\s+/g, ' ').trim();
  }

  function cleanPosition(s) {
    return String(s || '').replace(/\[[^\]]*\]\s*$/, '').replace(/\s+/g, ' ').trim();
  }

  function parseWeeks(text) {
    if (!text) return [];
    let t = String(text).replace(/\[[^\]]*节\]/g, '');
    t = t.replace(/[\[\]]/g, '').replace(/周/g, '').replace(/[（）()]/g, '').replace(/\s+/g, '');
    const out = {};
    t.split(',').forEach(function (seg) {
      if (!seg) return;
      const m = seg.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        for (let i = parseInt(m[1], 10); i <= parseInt(m[2], 10); i++) {
          if (i >= 1 && i <= 30) out[i] = 1;
        }
      } else if (/^\d+$/.test(seg)) {
        const v = parseInt(seg, 10);
        if (v >= 1 && v <= 30) out[v] = 1;
      }
    });
    return Object.keys(out).map(Number).sort(function (a, b) { return a - b; });
  }

  function parseSections(text) {
    const s = String(text || '');
    const m = s.match(/\[\s*(\d+)\s*-\s*(\d+)\s*节\s*\]/);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    const m2 = s.match(/\[\s*(\d+)\s*节\s*\]/);
    if (m2) return [parseInt(m2[1], 10), parseInt(m2[1], 10)];
    return null;
  }

  async function loadTermPage() {
    const res = await fetch(TERM_PAGE, { credentials: 'include', headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error('课表页请求失败 HTTP ' + res.status);
    return await res.text();
  }

  function fetchAcademicOptions(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cur = doc.querySelector('#cobTermNo_I');
    const currentText = cur ? cur.value : '';
    const texts = [];
    const lb = doc.querySelector('#cobTermNo_DDD_L_LBT');
    if (lb) {
      const tds = lb.querySelectorAll('td');
      for (let i = 0; i < tds.length; i++) {
        const t = (tds[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (t) texts.push(t);
      }
    }
    let values = [];
    const m = html.match(/dxo\.itemsValue\s*=\s*\[([^\]]*)\]/);
    if (m) values = m[1].split(',').map(function (s) { return s.trim().replace(/^'|'$/g, ''); });
    let def = texts.indexOf(currentText);
    if (def < 0) def = 0;
    return { texts: texts, values: values, currentText: currentText, def: def };
  }

  async function switchTerm(html, opts, idx) {
    const v = opts.values[idx];
    const target = opts.texts[idx];
    if (!v) throw new Error('没有取到该学期的学期代码，无法切换');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const vs = doc.querySelector('input[name="__VIEWSTATE"]');
    const vg = doc.querySelector('input[name="__VIEWSTATEGENERATOR"]');
    const wk = doc.querySelector('#txtweeks_I');
    const body = new URLSearchParams();
    body.set('__EVENTTARGET', '');
    body.set('__EVENTARGUMENT', '');
    if (vs) body.set('__VIEWSTATE', vs.value);
    if (vg) body.set('__VIEWSTATEGENERATOR', vg.value);
    body.set('cobTermNo$DDD$L', v);
    body.set('cobTermNo', target);
    body.set('cobTermNo_VI', v);
    if (wk) body.set('txtweeks', wk.value);
    const res = await fetch(TERM_PAGE, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) throw new Error('切换学期失败 HTTP ' + res.status);
    const out = await res.text();
    const nd = new DOMParser().parseFromString(out, 'text/html');
    const ci = nd.querySelector('#cobTermNo_I');
    const nowText = ci ? ci.value : '';
    const want = target.replace(/\[[^\]]*\]/g, '').trim();
    if (nowText.replace(/\[[^\]]*\]/g, '').trim() !== want) {
      throw new Error('切换学期未生效（页面仍显示 ' + nowText + '）');
    }
    return out;
  }

  function parseCell(cellHtml) {
    const lines = String(cellHtml || '').split(/<br\s*\/?>/i);
    const res = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const text = stripTags(raw).trim();
      if (!text) continue;
      if (/LessonIntroduce/i.test(raw)) {
        cur = { name: cleanName(text), teacher: '', position: '' };
        continue;
      }
      if (/TeacherIntroduce/i.test(raw)) {
        if (cur) cur.teacher = text;
        continue;
      }
      if (!cur) continue;
      if (/周/.test(text) && /节/.test(text)) {
        const weeks = parseWeeks(text);
        const sec = parseSections(text);
        if (weeks.length && sec) {
          res.push({
            name: cur.name, teacher: cur.teacher, position: cur.position,
            startSection: sec[0], endSection: sec[1], weeks: weeks
          });
        }
        cur = null;
        continue;
      }
      if (/^[▲\s]/.test(text) || /人\]/.test(text) || /查看更多/.test(text)) continue;
      if (/^[^\[\]]{1,24}\[[^\]]*\]$/.test(text)) { cur.position = cleanPosition(text); continue; }
    }
    return res;
  }

  function parseTimetable(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const extraByIndex = {};
    const re = /setContentArray\('((?:[^'\\]|\\.)*)',\s*(\d+)\)/g;
    let m;
    while ((m = re.exec(html))) {
      const content = m[1].replace(/\\'/g, "'");
      const key = m[2];
      if (!extraByIndex[key]) extraByIndex[key] = [];
      extraByIndex[key].push(content);
    }
    const table = doc.querySelector('#TableLCRoomOccupy');
    if (!table) throw new Error('页面里没找到课表表格，登录可能已失效');
    const list = [];
    for (let r = 1; r < table.rows.length; r++) {
      const cells = table.rows[r].cells;
      for (let c = 1; c <= 7 && c < cells.length; c++) {
        const cellHtml = cells[c].innerHTML || '';
        parseCell(cellHtml).forEach(function (e) { e.day = c; list.push(e); });
        const idxs = [];
        cellHtml.replace(/showMoreInfomation\('(\d+)'\)/g, function (_, id) { idxs.push(id); return ''; });
        idxs.forEach(function (id) {
          (extraByIndex[id] || []).forEach(function (blob) {
            blob.split('$').forEach(function (item) {
              const parts = item.split('^');
              if (parts.length < 5) return;
              const weeks = parseWeeks(parts[4]);
              const sec = parseSections(parts[4]);
              if (!weeks.length || !sec) return;
              list.push({
                name: cleanName(parts[0]),
                teacher: (parts[1] || '').trim(),
                position: cleanPosition(parts[2] || ''),
                day: c, startSection: sec[0], endSection: sec[1], weeks: weeks
              });
            });
          });
        });
      }
    }
    return list;
  }

  function sameWeeks(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
    return true;
  }

  function normalizeCourses(list) {
    const valid = [];
    let skipped = 0;
    list.forEach(function (c) {
      const day = parseInt(c.day, 10);
      const s = parseInt(c.startSection, 10);
      const e = parseInt(c.endSection, 10);
      const weeks = Array.isArray(c.weeks) ? c.weeks.filter(function (w) { return w >= 1 && w <= 30; }) : [];
      if (!c.name || !(day >= 1 && day <= 7) || !(s >= 1) || !(e >= s) || !weeks.length) { skipped++; return; }
      const uniq = {};
      weeks.forEach(function (w) { uniq[w] = 1; });
      valid.push({
        name: c.name, teacher: c.teacher || '', position: c.position || '', day: day,
        startSection: s, endSection: e,
        weeks: Object.keys(uniq).map(Number).sort(function (a, b) { return a - b; })
      });
    });

    const groups = {};
    valid.forEach(function (c) {
      const k = [c.name, c.teacher, c.position, c.day].join('|');
      (groups[k] = groups[k] || []).push(c);
    });
    let phase1 = [];
    Object.keys(groups).forEach(function (k) {
      const arr = groups[k].slice().sort(function (a, b) { return a.startSection - b.startSection; });
      const merged = [];
      arr.forEach(function (c) {
        const last = merged[merged.length - 1];
        if (last && sameWeeks(last.weeks, c.weeks) && c.startSection <= last.endSection + 1) {
          last.endSection = Math.max(last.endSection, c.endSection);
          last.startSection = Math.min(last.startSection, c.startSection);
        } else {
          merged.push({
            name: c.name, teacher: c.teacher, position: c.position, day: c.day,
            startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
          });
        }
      });
      phase1 = phase1.concat(merged);
    });

    // 同课同节次时合并周次并集
    const map2 = {};
    phase1.forEach(function (c) {
      const k = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!map2[k]) {
        map2[k] = {
          name: c.name, teacher: c.teacher, position: c.position, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weekSet: {}
        };
      }
      c.weeks.forEach(function (w) { map2[k].weekSet[w] = 1; });
    });
    const courses = Object.keys(map2).map(function (k) {
      const o = map2[k];
      return {
        name: o.name, position: o.position, teacher: o.teacher, day: o.day,
        startSection: o.startSection, endSection: o.endSection,
        weeks: Object.keys(o.weekSet).map(Number).sort(function (a, b) { return a - b; })
      };
    });
    return { courses: courses, skipped: skipped };
  }

  async function runImportFlow() {
    toast('正在读取课表…');
    let html = await loadTermPage();
    const opts = fetchAcademicOptions(html);
    if (!opts.texts.length) throw new Error('未解析到学年学期列表，登录可能已失效');

    let idx = opts.def;
    // 只有一个学期时直接使用，避免多余的选择交互
    if (opts.texts.length > 1) {
      const picked = await select('选择要导入的学年学期', opts.texts, opts.def);
      const i = Number(picked);
      if (picked === null || picked === undefined || !Number.isInteger(i) || i < 0 || !opts.texts[i]) {
        toast('已取消，未导入');
        return;
      }
      idx = i;
    }

    if (idx !== opts.def) html = await switchTerm(html, opts, idx);

    const raw = parseTimetable(html);
    const result = normalizeCourses(raw);
    if (!result.courses.length) {
      throw new Error('未解析到课程（原始记录 ' + raw.length + ' 条），请确认该学期已排课');
    }

    let tip = '学期：' + opts.texts[idx] + '\n课程：' + result.courses.length + ' 条';
    if (result.skipped) tip += '\n跳过：' + result.skipped + ' 条信息不全的记录';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    const saved = await saveOk('saveImportedCourses', JSON.stringify(result.courses));
    if (!saved) throw new Error('课程保存失败');

    await notifyTaskCompletion();
    toast('已导入 ' + result.courses.length + ' 条课程' +
      (result.skipped ? '，跳过 ' + result.skipped + ' 条异常' : ''));
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
