(async function () {
  const BASE = location.origin;
  const BP = window.shiguangBridgePromise || {};
  const BR = window.shiguangBridge || {};

  async function callUI(name, args) {
    if (BP && typeof BP[name] === 'function') return BP[name].apply(BP, args);
    if (BR && typeof BR[name] === 'function') return BR[name].apply(BR, args);
    throw new Error('当前环境缺少交互方法：' + name);
  }

  async function saveBridge(name, payload) {
    if (!BP || typeof BP[name] !== 'function') throw new Error('当前环境缺少保存方法：' + name);
    return BP[name](payload);
  }

  function htmlText(html) {
    const doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
    return doc.body.textContent || '';
  }
  function clean(html) {
    return htmlText(html).replace(/\s+/g, ' ').trim();
  }
  function fontText(html, title) {
    const doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
    const f = doc.querySelector('font[title="' + title + '"]');
    return f ? (f.textContent || '').trim() : '';
  }

  async function fetchAcademicOptions() {
    const resp = await fetch(BASE + '/jsxsd/xskb/xskb_list.do', { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('课表查询页请求失败：' + resp.status);
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const semSel = doc.querySelector('#xnxq01id');
    if (!semSel) throw new Error('页面找不到学年学期下拉框 #xnxq01id');
    const semesters = Array.from(semSel.querySelectorAll('option')).map(function (o) {
      return { value: o.value, text: (o.textContent || '').trim(), selected: o.hasAttribute('selected') };
    });
    const camSel = doc.querySelector('#kbjcmsid');
    const campuses = camSel ? Array.from(camSel.querySelectorAll('option')).map(function (o) {
      return { value: o.value, text: (o.textContent || '').trim(), selected: o.hasAttribute('selected') };
    }) : [];
    return { semesters: semesters, campuses: campuses };
  }

  async function chooseSemester(opts) {
    const semTexts = opts.semesters.map(function (s) { return s.text; });
    let defSem = opts.semesters.findIndex(function (s) { return s.selected; });
    if (defSem < 0) defSem = 0;
    const si = await callUI('showSingleSelection', ['选择学年学期', JSON.stringify(semTexts), defSem]);
    if (si === null || si === -1 || si === undefined) return null;
    const semester = opts.semesters[si];
    if (!semester) return null;
    // 只有一个校区/时间模式时不必再弹一次选择框
    let campus = null;
    if (opts.campuses.length === 1) {
      campus = opts.campuses[0];
    } else if (opts.campuses.length > 1) {
      const camTexts = opts.campuses.map(function (c) { return c.text; });
      let defCam = opts.campuses.findIndex(function (c) { return c.selected; });
      if (defCam < 0) defCam = 0;
      const ci = await callUI('showSingleSelection', ['选择校区/时间模式', JSON.stringify(camTexts), defCam]);
      if (ci === null || ci === -1 || ci === undefined) return null;
      campus = opts.campuses[ci];
    }
    return { semester: semester, campus: campus };
  }

  async function fetchTimetableHtml(semester, campus) {
    const params = new URLSearchParams();
    params.set('xnxq01id', semester.value);
    params.set('zc', '');
    if (campus && campus.value) params.set('kbjcmsid', campus.value);
    params.set('wkbkc', '1');
    const resp = await fetch(BASE + '/jsxsd/xskb/xskb_list.do?' + params.toString(), { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('课表数据请求失败：' + resp.status);
    const html = await resp.text();
    if (html.indexOf('id="timetable"') < 0 && html.indexOf("id='timetable'") < 0) {
      throw new Error('返回页面里没有课表表格，登录可能已失效');
    }
    return html;
  }

  function parseSection(text) {
    if (!text) return null;
    // 兼容「1-16(周)[1-2节]」「1-16周[1-2节]」「1-15(单周)」「1,3,5周」等写法
    const t = String(text).replace(/\s+/g, '');
    const m = t.match(/^([0-9,，、\-~—－]+)[\(（]?(单|双)?周[\)）]?[\[【]([0-9\-－]+)节[\]】]/);
    if (!m) return null;
    const weeks = [];
    m[1].split(/[,，、]/).forEach(function (part) {
      const seg = part.split(/[\-~—－]/).filter(function (x) { return x !== ''; });
      if (seg.length === 2) {
        const a = parseInt(seg[0], 10), b = parseInt(seg[1], 10);
        if (!isNaN(a) && !isNaN(b)) { for (let w = a; w <= b; w++) weeks.push(w); }
      } else {
        seg.forEach(function (x) {
          const v = parseInt(x, 10);
          if (!isNaN(v)) weeks.push(v);
        });
      }
    });
    const nums = m[3].split(/[\-－]/).map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); });
    if (!nums.length || !weeks.length) return null;
    let ws = weeks;
    if (m[2] === '单') ws = weeks.filter(function (w) { return w % 2 === 1; });
    if (m[2] === '双') ws = weeks.filter(function (w) { return w % 2 === 0; });
    if (!ws.length) return null;
    const minSec = Math.min.apply(null, nums), maxSec = Math.max.apply(null, nums);
    return {
      weeks: Array.from(new Set(ws)).sort(function (a, b) { return a - b; }),
      startSection: Math.ceil(minSec / 2),
      endSection: Math.ceil(maxSec / 2)
    };
  }

  function parseTimetable(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table#timetable');
    if (!table) throw new Error('找不到课表表格 #timetable');
    const rows = Array.from(table.querySelectorAll('tr'));
    const out = [];
    rows.forEach(function (row, r) {
      if (r === 0) return;
      const th = row.querySelector('th');
      if (!th) return;
      const thTxt = (th.textContent || '').replace(/\s+/g, ' ');
      if (thTxt.indexOf('大节') < 0) return;
      const tds = Array.from(row.querySelectorAll('td'));
      tds.forEach(function (td, c) {
        if (c > 6) return;
        const day = c + 1;
        const detail = td.querySelector('div.kbcontent[id$="-2"]');
        if (!detail) return;
        const raw = (detail.innerHTML || '').replace(/&nbsp;/gi, ' ');
        const blocks = raw.split(/-{5,}/);
        blocks.forEach(function (block) {
          const b = block.trim();
          if (!b) return;
          const firstBr = b.split(/<br\s*\/?>/i)[0];
          const name = clean(firstBr);
          if (!name) return;
          const teacher = clean(fontText(b, '教师'));
          const position = clean(fontText(b, '教室'));
          const sec = parseSection(fontText(b, '周次(节次)'));
          if (!sec) return;
          out.push({
            name: name, teacher: teacher, position: position, day: day,
            startSection: sec.startSection, endSection: sec.endSection, weeks: sec.weeks
          });
        });
      });
    });
    return out;
  }

  function parseTimeSlots(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table#timetable');
    if (!table) return [];
    const slots = [];
    Array.from(table.querySelectorAll('tr')).forEach(function (row, r) {
      if (r === 0) return;
      const th = row.querySelector('th');
      if (!th) return;
      const txt = (th.textContent || '').replace(/\s+/g, ' ');
      if (txt.indexOf('大节') < 0) return;
      const m = txt.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      if (m) slots.push({ number: r, startTime: m[1], endTime: m[2] });
    });
    return slots;
  }

  function normalizeCourses(list) {
    let skipped = 0;
    const valid = [];
    list.forEach(function (c) {
      if (!c.name || !(c.day >= 1 && c.day <= 7) ||
          !(c.startSection >= 1 && c.startSection <= 6) ||
          !(c.endSection >= c.startSection && c.endSection <= 6) ||
          !Array.isArray(c.weeks) || !c.weeks.length) {
        skipped++; return;
      }
      const cc = Object.assign({}, c);
      cc.weeks = Array.from(new Set(c.weeks)).sort(function (a, b) { return a - b; });
      valid.push(cc);
    });

    const stage1 = [];
    valid.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      let hit = null;
      for (let i = 0; i < stage1.length; i++) { if (stage1[i]._key === key) { hit = stage1[i]; break; } }
      if (hit) {
        if (c.startSection === hit.endSection + 1) hit.endSection = c.endSection;
        else if (hit.startSection === c.endSection + 1) hit.startSection = c.startSection;
        else if (c.startSection >= hit.startSection && c.endSection <= hit.endSection) { }
        else if (hit.startSection >= c.startSection && hit.endSection <= c.endSection) {
          hit.startSection = c.startSection; hit.endSection = c.endSection;
        } else {
          stage1.push(Object.assign({}, c, { _key: key + '#' + c.startSection + '-' + c.endSection }));
        }
      } else {
        stage1.push(Object.assign({}, c, { _key: key }));
      }
    });

    const stage2 = [];
    stage1.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      let hit = null;
      for (let i = 0; i < stage2.length; i++) { if (stage2[i]._key === key) { hit = stage2[i]; break; } }
      if (hit) {
        hit.weeks = Array.from(new Set(hit.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      } else {
        stage2.push(Object.assign({}, c, { _key: key }));
      }
    });

    const courses = stage2.map(function (c) {
      return {
        name: c.name, position: c.position, teacher: c.teacher, day: c.day,
        startSection: c.startSection, endSection: c.endSection, weeks: c.weeks
      };
    });
    return { courses: courses, skipped: skipped };
  }

  async function runImportFlow() {
    try {
      const go = await callUI('showAlert', ['整学期课表导入', '将从教务系统读取所选学期的整学期课表（全部周次，不是当前周）。', '开始导入']);
      if (go === false) {
        await callUI('showToast', ['已取消导入']);
        return;
      }
      const opts = await fetchAcademicOptions();
      const chosen = await chooseSemester(opts);
      if (!chosen) {
        await callUI('showToast', ['已取消导入']);
        return;
      }
      const html = await fetchTimetableHtml(chosen.semester, chosen.campus);
      const timeSlots = parseTimeSlots(html);
      const raw = parseTimetable(html);
      const norm = normalizeCourses(raw);
      if (!norm.courses.length) {
        await callUI('showAlert', ['导入失败', '没有从课表中解析出课程，请确认所选学期是否有课表。', '知道了']);
        return;
      }
      const saved = await saveBridge('saveImportedCourses', JSON.stringify(norm.courses));
      if (saved === false || saved === null || saved === undefined) throw new Error('课程保存失败');
      if (timeSlots.length) {
        try {
          const slotsSaved = await saveBridge('savePresetTimeSlots', JSON.stringify(timeSlots));
          if (slotsSaved === false || slotsSaved === null || slotsSaved === undefined) {
            await callUI('showToast', ['作息保存失败，课程已导入']);
          }
        } catch (_) {
          await callUI('showToast', ['作息保存失败，课程已导入']);
        }
      }
      await callUI('showToast', ['整学期课表已导入：' + norm.courses.length + ' 门课程' + (norm.skipped ? '（跳过 ' + norm.skipped + ' 条异常）' : '')]);
      if (BR && typeof BR.notifyTaskCompletion === 'function') BR.notifyTaskCompletion();
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      try { await callUI('showAlert', ['导入出错', msg, '知道了']); } catch (_) { }
      throw err;
    }
  }

  await runImportFlow();
})();
