(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BR = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  async function uiAlert(title, content, confirmText) {
    if (BP && typeof BP.showAlert === 'function') {
      return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
    }
    if (BR && typeof BR.showAlert === 'function') {
      return (await BR.showAlert(title, content, confirmText || '确定')) !== false;
    }
    return true;
  }

  async function uiSelect(title, labels, defaultIndex) {
    if (BP && typeof BP.showSingleSelection === 'function') {
      const r = await BP.showSingleSelection(title, JSON.stringify(labels), defaultIndex);
      if (r === null || r === undefined) return -1;
      const n = Number(r);
      return Number.isInteger(n) && n >= 0 && n < labels.length ? n : -1;
    }
    return labels.length === 1 ? 0 : -1;
  }

  function uiToast(msg) {
    try {
      if (BR && typeof BR.showToast === 'function') { BR.showToast(msg); return; }
      if (BP && typeof BP.showToast === 'function') { BP.showToast(msg); }
    } catch (e) {}
  }

  function clock(s) {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? m[1].padStart(2, '0') + ':' + m[2] : null;
  }

  function parseSlots(html, unitCount) {
    const map = new Map();
    const push = function (n, st, et) {
      const a = clock(st), b = clock(et);
      if (n >= 1 && n <= 30 && a && b && a < b && !map.has(n)) {
        map.set(n, { number: n, startTime: a, endTime: b });
      }
    };

    const arrM = html.match(/var\s+(?:unitTime|unitTimes|timeArray|times)\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (arrM) {
      try {
        const arr = JSON.parse(arrM[1].replace(/'/g, '"'));
        arr.forEach(function (v, i) {
          const m = String(v).match(/(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
          if (m) push(i + 1, m[1], m[2]);
        });
      } catch (e) {}
    }

    const re = /第\s*(\d+)\s*节[\s\S]{0,160}?(\d{1,2}:\d{2})[\s\S]{0,80}?(\d{1,2}:\d{2})/g;
    let m;
    while ((m = re.exec(html))) push(parseInt(m[1], 10), m[2], m[3]);

    const list = Array.from(map.values()).sort(function (a, b) { return a.number - b.number; });
    if (!list.length) return [];
    if (unitCount && list.length < Math.min(unitCount, 6)) return [];
    return list;
  }

  function parseTimeTable(html) {
    const ucM = html.match(/var\s+unitCount\s*=\s*(\d+)/);
    const unitCount = ucM ? parseInt(ucM[1], 10) : 12;
    const mtM = html.match(/marshalTable\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/);
    const from = mtM ? parseInt(mtM[1], 10) : 2;
    const totalWeeks = mtM ? parseInt(mtM[3], 10) : 19;

    const acts = [];
    const actRe = /activity\s*=\s*new\s+TaskActivity\(([\s\S]*?)\);/g;
    let am;
    while ((am = actRe.exec(html))) acts.push({ param: am[1], pos: am.index, end: am.index + am[0].length });

    const teachersArr = [];
    const tRe = /var\s+actTeachers\s*=\s*\[([\s\S]*?)\];/g;
    let tm;
    while ((tm = tRe.exec(html))) {
      const names = [];
      const nRe = /name\s*:\s*"([^"]*)"/g;
      let nm;
      while ((nm = nRe.exec(tm[1]))) names.push(nm[1]);
      teachersArr.push(names);
    }

    const raw = [];
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const nextPos = i + 1 < acts.length ? acts[i + 1].pos : html.length;
      const seg = html.slice(a.end, nextPos);

      const strs = [];
      const sr = /"((?:[^"\\]|\\.)*)"/g;
      let s;
      while ((s = sr.exec(a.param))) strs.push(s[1]);

      let weeksBits = '';
      for (let q = 0; q < strs.length; q++) {
        if (/^[01]{40,}$/.test(strs[q])) { weeksBits = strs[q]; break; }
      }

      let courseRaw = '';
      let roomName = '';
      let codeIdx = -1;
      for (let k = 0; k < strs.length; k++) {
        if (/\(\d{4,}[^)]*\)\s*$/.test(strs[k]) && !/^[01]+$/.test(strs[k])) { codeIdx = k; break; }
      }
      if (codeIdx >= 0) {
        courseRaw = strs[codeIdx];
        const rooms = [];
        for (let r = codeIdx + 1; r < strs.length; r++) {
          if (!/^\d+$/.test(strs[r]) && !/^[01]+$/.test(strs[r]) && strs[r] !== ',') rooms.push(strs[r]);
        }
        // 优先取带中文的教室名，避免拿到 roomId 这类短编号
        for (let r = 0; r < rooms.length; r++) {
          if (/[\u4e00-\u9fa5]/.test(rooms[r])) { roomName = rooms[r]; break; }
        }
        if (!roomName && rooms.length) roomName = rooms[0];
      }

      const name = courseRaw.replace(/\([^)]*\)\s*$/, '').trim();
      const slots = [];
      const ir = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)/g;
      let im;
      while ((im = ir.exec(seg))) {
        slots.push({ day: parseInt(im[1], 10) + 1, sec: parseInt(im[2], 10) + 1 });
      }

      const weeks = [];
      for (let n = 1; n <= totalWeeks && n <= 30; n++) {
        const wi = from + n - 2;
        if (wi >= 0 && wi < weeksBits.length && weeksBits.charAt(wi) === '1') weeks.push(n);
      }

      if (!name || !weeksBits || !slots.length || !weeks.length) continue;
      raw.push({
        name: name,
        teacher: (teachersArr[i] || []).join(','),
        position: roomName,
        slots: slots,
        weeks: weeks
      });
    }
    return { raw: raw, unitCount: unitCount, totalWeeks: totalWeeks, actCount: acts.length };
  }

  function normalizeCourses(raw) {
    const valid = [];
    let skipped = 0;
    raw.forEach(function (c) {
      if (!c.name || !c.weeks.length) { skipped++; return; }
      const byDay = {};
      c.slots.forEach(function (sl) {
        if (sl.day < 1 || sl.day > 7 || sl.sec < 1 || sl.sec > 30) { skipped++; return; }
        (byDay[sl.day] = byDay[sl.day] || []).push(sl.sec);
      });
      Object.keys(byDay).forEach(function (d) {
        const secs = Array.from(new Set(byDay[d])).sort(function (a, b) { return a - b; });
        if (!secs.length) return;
        let ss = secs[0];
        let se = secs[0];
        const segs = [];
        for (let i = 1; i < secs.length; i++) {
          if (secs[i] === se + 1) { se = secs[i]; }
          else { segs.push([ss, se]); ss = secs[i]; se = secs[i]; }
        }
        segs.push([ss, se]);
        segs.forEach(function (g) {
          valid.push({
            name: c.name, teacher: c.teacher || '', position: c.position || '',
            day: parseInt(d, 10), startSection: g[0], endSection: g[1], weeks: c.weeks.slice()
          });
        });
      });
    });

    const step1 = [];
    valid.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      let found = false;
      for (let i = 0; i < step1.length; i++) {
        const e = step1[i];
        if ([e.name, e.teacher, e.position, e.day, e.weeks.join(',')].join('|') === key &&
            c.startSection <= e.endSection + 1 && e.startSection <= c.endSection + 1) {
          e.startSection = Math.min(e.startSection, c.startSection);
          e.endSection = Math.max(e.endSection, c.endSection);
          found = true;
          break;
        }
      }
      if (!found) step1.push(Object.assign({}, c, { weeks: c.weeks.slice() }));
    });

    const step2 = [];
    step1.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      let e = null;
      for (let i = 0; i < step2.length; i++) {
        if ([step2[i].name, step2[i].teacher, step2[i].position, step2[i].day, step2[i].startSection, step2[i].endSection].join('|') === key) {
          e = step2[i];
          break;
        }
      }
      if (e) {
        const set = {};
        e.weeks.concat(c.weeks).forEach(function (w) { set[w] = 1; });
        e.weeks = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
      } else {
        step2.push(Object.assign({}, c, { weeks: c.weeks.slice() }));
      }
    });
    return { courses: step2, skipped: skipped };
  }

  async function runImportFlow() {
    const go = await uiAlert('课表导入', '即将从教务系统读取并导入本学期课表。', '开始导入');
    if (!go) {
      uiToast('已取消，未导入');
      return;
    }

    const base = location.origin;
    const pageR = await fetch(base + '/eams/courseTableForStd.action?_=' + Date.now(), { credentials: 'include' });
    if (!pageR.ok) throw new Error('课表页请求失败：' + pageR.status);
    const page = await pageR.text();

    const idsM = page.match(/addInput\(form\s*,\s*["']ids["']\s*,\s*["'](\d+)["']/);
    const ids = idsM ? idsM[1] : '';
    if (!ids) throw new Error('课表页未取得学生 ids，请确认已登录教务系统');

    const curM = page.match(/semesterCalendar\(\{[^}]*value:\s*["']?(\d+)["']?/);
    const cur = curM ? curM[1] : '';
    const tagM = page.match(/id="(semesterBar[^"]*Semester)"/);
    const tag = tagM ? tagM[1] : '';

    let labels = [];
    let semIds = [];
    let def = 0;
    let semId = cur;
    try {
      const dqR = await fetch(base + '/eams/dataQuery.action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'tagId=' + encodeURIComponent(tag) + '&dataType=semesterCalendar&value=' + encodeURIComponent(cur) + '&empty=false',
        credentials: 'include'
      });
      const dq = await dqR.text();
      let data = null;
      try { data = Function('return (' + dq.replace(/[\r\n]+/g, '').trim() + ')')(); } catch (e) {}
      if (data && data.semesters) {
        Object.keys(data.semesters).forEach(function (k) {
          (data.semesters[k] || []).forEach(function (s) {
            labels.push(s.schoolYear + ' 学年第' + s.name + '学期');
            semIds.push(String(s.id));
            if (String(data.semesterId) === String(s.id)) def = labels.length - 1;
          });
        });
      }
      if (data && data.semesterId) semId = String(data.semesterId);
    } catch (e) {}

    if (labels.length > 1) {
      const sel = await uiSelect('选择学年学期', labels, def);
      if (sel < 0) {
        uiToast('已取消，未导入');
        return;
      }
      semId = semIds[sel] || semId;
    }
    if (!semId) throw new Error('未取得学年学期，请刷新后重试');

    const ttR = await fetch(base + '/eams/courseTableForStd!courseTable.action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: 'setting.kind=std&startWeek=&semester.id=' + encodeURIComponent(semId) + '&ids=' + encodeURIComponent(ids) + '&project.id=',
      credentials: 'include'
    });
    const html = await ttR.text();
    if (!html || html.indexOf('TaskActivity') === -1) throw new Error('课表接口未返回有效数据，请重新登录后重试');

    const parsed = parseTimeTable(html);
    const norm = normalizeCourses(parsed.raw);
    if (!norm.courses.length) throw new Error('课表里没有解析到任何课程');

    const slots = parseSlots(page, parsed.unitCount);

    const confirmed = await uiAlert(
      '确认导入',
      '课程：' + norm.courses.length + ' 门' +
        (norm.skipped > 0 ? '（跳过异常 ' + norm.skipped + ' 条）' : '') +
        '\n周数：' + parsed.totalWeeks +
        (slots.length ? '\n作息：' + slots.length + ' 节' : '') +
        '\n\n导入会覆盖当前课表。',
      '导入'
    );
    if (!confirmed) {
      uiToast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(norm.courses));
    if (saved === false || saved === 'false') throw new Error('课程保存失败');

    let configFailed = false;
    let slotsFailed = false;
    try {
      await BP.saveCourseConfig(JSON.stringify({ semesterTotalWeeks: parsed.totalWeeks }));
    } catch (e) {
      configFailed = true;
    }
    if (slots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(slots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BR && typeof BR.notifyTaskCompletion === 'function') BR.notifyTaskCompletion();

    const warn = configFailed || slotsFailed ? '（' + (configFailed ? '校历未保存 ' : '') + (slotsFailed ? '作息未保存' : '') + '）' : '';
    uiToast('导入完成：' + norm.courses.length + ' 门课' + warn);
  }

  try {
    await runImportFlow();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await uiAlert('导入失败', msg, '知道了');
    uiToast('导入失败：' + msg);
  }
})();
