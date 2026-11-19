(async function () {
  const BASE = location.origin;
  const BP = window.shiguangBridgePromise || {};
  const BR = window.shiguangBridge || {};

  // 河南理工大学作息：秋季（10·1-5·1）与春季（5·1-10·1），每学期 11 小节
  const AUTUMN_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' },
    { number: 3, startTime: '10:00', endTime: '10:45' },
    { number: 4, startTime: '10:55', endTime: '11:40' },
    { number: 5, startTime: '11:50', endTime: '12:35' },
    { number: 6, startTime: '14:30', endTime: '15:15' },
    { number: 7, startTime: '15:25', endTime: '16:10' },
    { number: 8, startTime: '16:30', endTime: '17:15' },
    { number: 9, startTime: '17:25', endTime: '18:10' },
    { number: 10, startTime: '19:00', endTime: '19:45' },
    { number: 11, startTime: '19:55', endTime: '20:40' }
  ];
  const SPRING_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' },
    { number: 3, startTime: '10:00', endTime: '10:45' },
    { number: 4, startTime: '10:55', endTime: '11:40' },
    { number: 5, startTime: '11:50', endTime: '12:35' },
    { number: 6, startTime: '15:00', endTime: '15:45' },
    { number: 7, startTime: '15:55', endTime: '16:40' },
    { number: 8, startTime: '17:00', endTime: '17:45' },
    { number: 9, startTime: '17:55', endTime: '18:40' },
    { number: 10, startTime: '19:30', endTime: '20:15' },
    { number: 11, startTime: '20:25', endTime: '21:10' }
  ];

  async function callUI(name, args) {
    if (BP && typeof BP[name] === 'function') return BP[name].apply(BP, args);
    if (BR && typeof BR[name] === 'function') return BR[name].apply(BR, args);
    throw new Error('当前环境缺少交互方法：' + name);
  }

  async function saveBridge(name, payload) {
    if (!BP || typeof BP[name] !== 'function') throw new Error('当前环境缺少保存方法：' + name);
    return BP[name](payload);
  }

  function semesterLabel(year, name) {
    const y = String(year || '').trim();
    const n = String(name || '').trim();
    if (!y) return n;
    if (!n) return y;
    if (/学期|季/.test(n)) return y + ' ' + n;
    return y + '学年 第' + n + '学期';
  }

  async function fetchPage() {
    const resp = await fetch(BASE + '/eams/courseTableForStd.action', { credentials: 'include' });
    if (!resp.ok) throw new Error('课表页请求失败：' + resp.status);
    const html = await resp.text();
    const idsM = html.match(/addInput\(\s*form\s*,\s*["']ids["']\s*,\s*["']([^"']+)["']\s*\)/i)
      || html.match(/name=["']ids["'][^>]*value=["']([^"']+)["']/i)
      || html.match(/id=["']ids["'][^>]*value=["']([^"']+)["']/i);
    const semM = html.match(/semesterCalendar\s*\([^)]*?value\s*:\s*["']?(\d+)["']?/i)
      || html.match(/semester\.id\s*=\s*["']?(\d+)["']?/i);
    const ids = idsM ? idsM[1] : '';
    if (!ids) throw new Error('没取到学生课表编号，登录可能已失效');
    return { ids: ids, semesterId: semM ? semM[1] : '', html: html };
  }

  async function fetchSemesters() {
    const resp = await fetch(BASE + '/eams/dataQuery.action', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'dataType=semesterCalendar&value=&empty=f'
    });
    if (!resp.ok) return [];
    const text = await resp.text();
    const blocks = text.match(/\{[^{}]*schoolYear[^{}]*\}/g) || [];
    const list = [];
    const seen = {};
    blocks.forEach(function (b) {
      const id = (b.match(/\bid\s*:\s*["']?(\d+)["']?/) || [])[1];
      const year = (b.match(/schoolYear\s*:\s*["']([^"']*)["']/) || [])[1] || '';
      const name = (b.match(/\bname\s*:\s*["']([^"']*)["']/) || [])[1] || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      list.push({ id: id, year: year, name: name, label: semesterLabel(year, name) });
    });
    return list;
  }

  async function chooseSemester(pageSemesterId) {
    const list = await fetchSemesters();
    if (!list.length) {
      if (!pageSemesterId) throw new Error('没找到学期信息');
      return { id: pageSemesterId, name: '', label: '当前学期' };
    }
    if (list.length === 1) return list[0];
    let def = list.findIndex(function (s) { return s.id === pageSemesterId; });
    if (def < 0) def = 0;
    const idx = await callUI('showSingleSelection', ['选择学期', JSON.stringify(list.map(function (s) { return s.label; })), def]);
    if (idx === null || idx === -1 || idx === undefined) return null;
    return list[idx] || null;
  }

  async function fetchCourseTable(ids, semesterId) {
    const resp = await fetch(BASE + '/eams/courseTableForStd!courseTable.action', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'ignoreHead=1&setting.kind=std&startWeek=&semester.id=' + encodeURIComponent(semesterId) + '&ids=' + encodeURIComponent(ids)
    });
    if (!resp.ok) throw new Error('课表数据请求失败：' + resp.status);
    return await resp.text();
  }

  function expandWeeks(text) {
    const set = [];
    String(text || '').split(/[,，、]/).forEach(function (part) {
      const seg = part.split(/[-~—－]/).filter(function (x) { return x !== ''; });
      if (seg.length === 2) {
        const a = parseInt(seg[0], 10), b = parseInt(seg[1], 10);
        if (!isNaN(a) && !isNaN(b)) { for (let w = a; w <= b; w++) set.push(w); }
      } else if (seg.length === 1) {
        const v = parseInt(seg[0], 10);
        if (!isNaN(v)) set.push(v);
      }
    });
    return Array.from(new Set(set)).filter(function (w) { return w >= 1 && w <= 30; }).sort(function (a, b) { return a - b; });
  }

  function parseActivities(js) {
    const text = String(js || '');
    const parts = text.split(/new\s+TaskActivity\s*\(/).slice(1);
    const out = [];
    parts.forEach(function (chunk) {
      const close = chunk.indexOf(')');
      const head = close >= 0 ? chunk.slice(0, close) : chunk;
      const args = [];
      const argRe = /["']([^"']*)["']/g;
      let am;
      while ((am = argRe.exec(head)) !== null && args.length < 8) args.push(am[1]);

      const str = function (key) {
        const m = chunk.match(new RegExp('activity\\.' + key + '\\s*=\\s*["\']([^"\']*)["\']'));
        return m ? m[1] : '';
      };
      const num = function (key) {
        const m = chunk.match(new RegExp('activity\\.' + key + '\\s*=\\s*["\']?(\\d+)'));
        return m ? parseInt(m[1], 10) : NaN;
      };
      const strAny = function (keys) {
        for (let i = 0; i < keys.length; i++) {
          const v = str(keys[i]);
          if (v) return v;
        }
        return '';
      };
      const numAny = function (keys) {
        for (let i = 0; i < keys.length; i++) {
          const v = num(keys[i]);
          if (!isNaN(v)) return v;
        }
        return NaN;
      };

      const validM = chunk.match(/activity\.valid\s*=\s*(true|false)/);
      if (validM && validM[1] === 'false') return;

      const name = strAny(['name', 'courseName']) || args[3] || '';
      const teacher = strAny(['teacherName', 'teacher']) || args[1] || '';
      const position = strAny(['place', 'room', 'roomName']) || args[5] || '';
      const day = numAny(['dayOfWeek', 'day']);
      const start = numAny(['startTime', 'startSection']);
      const end = numAny(['endTime', 'endSection']);

      let weeks = expandWeeks(str('weekIndexes'));
      if (!weeks.length) {
        const sw = numAny(['startWeek', 'weekStart']);
        const ew = numAny(['endWeek', 'weekEnd']);
        const step = numAny(['step']);
        if (!isNaN(sw) && !isNaN(ew)) {
          for (let w = sw; w <= ew; w += (step >= 2 ? 2 : 1)) weeks.push(w);
          weeks = Array.from(new Set(weeks)).sort(function (a, b) { return a - b; });
        }
      }

      if (!name || !(day >= 1 && day <= 7) || isNaN(start) || isNaN(end) || !weeks.length) return;
      out.push({
        name: name,
        teacher: teacher,
        position: position,
        day: day,
        startSection: Math.min(start, end),
        endSection: Math.max(start, end),
        weeks: weeks
      });
    });
    return out;
  }

  function normalizeCourses(list) {
    let skipped = 0;
    const valid = [];
    list.forEach(function (c) {
      if (!c.name || !(c.day >= 1 && c.day <= 7) ||
          !(c.startSection >= 1 && c.startSection <= 11) ||
          !(c.endSection >= c.startSection && c.endSection <= 11) ||
          !Array.isArray(c.weeks) || !c.weeks.length) {
        skipped++; return;
      }
      const cc = Object.assign({}, c);
      cc.weeks = Array.from(new Set(c.weeks)).sort(function (a, b) { return a - b; });
      valid.push(cc);
    });

    // 同名同师同地点同周次、节次连续的合并
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

    // 同名同师同地点同节次，周次取并集
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

    return {
      courses: stage2.map(function (c) {
        return {
          name: c.name, teacher: c.teacher, position: c.position, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: c.weeks
        };
      }),
      skipped: skipped
    };
  }

  function slotsFor(semester) {
    const name = semester ? String(semester.name || '').trim() : '';
    if (name === '2') return SPRING_SLOTS;
    if (name === '1') return AUTUMN_SLOTS;
    const now = new Date();
    const md = (now.getMonth() + 1) * 100 + now.getDate();
    return (md >= 501 && md < 1001) ? SPRING_SLOTS : AUTUMN_SLOTS;
  }

  async function runImportFlow() {
    try {
      const go = await callUI('showAlert', ['河南理工大学课表导入', '将读取所选学期的整学期课表（全部周次，不是当前周）。', '开始导入']);
      if (go === false) {
        await callUI('showToast', ['已取消导入']);
        return;
      }
      const page = await fetchPage();
      const semester = await chooseSemester(page.semesterId);
      if (!semester) {
        await callUI('showToast', ['已取消导入']);
        return;
      }
      const js = await fetchCourseTable(page.ids, semester.id);
      if (js.indexOf('TaskActivity') < 0) throw new Error('课表返回内容不是预期格式，登录可能已失效');
      const raw = parseActivities(js);
      if (!raw.length) throw new Error('课表里没有解析到任何课程记录');
      const norm = normalizeCourses(raw);
      if (!norm.courses.length) {
        await callUI('showAlert', ['导入失败', '没有从课表中解析出有效课程，请确认所选学期是否有课。', '知道了']);
        return;
      }
      const saved = await saveBridge('saveImportedCourses', JSON.stringify(norm.courses));
      if (saved === false || saved === null || saved === undefined) throw new Error('课程保存失败');
      try {
        const slots = slotsFor(semester);
        const slotsSaved = await saveBridge('savePresetTimeSlots', JSON.stringify(slots));
        if (slotsSaved === false || slotsSaved === null || slotsSaved === undefined) {
          await callUI('showToast', ['作息保存失败，课程已导入']);
        }
      } catch (_) {
        await callUI('showToast', ['作息保存失败，课程已导入']);
      }
      await callUI('showToast', ['课表已导入：' + norm.courses.length + ' 门课程' + (norm.skipped ? '（跳过 ' + norm.skipped + ' 条异常）' : '')]);
      if (BR && typeof BR.notifyTaskCompletion === 'function') BR.notifyTaskCompletion();
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      try { await callUI('showAlert', ['导入出错', msg, '知道了']); } catch (_) { }
      throw err;
    }
  }

  await runImportFlow();
})();
