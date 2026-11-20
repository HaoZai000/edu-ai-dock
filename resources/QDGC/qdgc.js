(async function main() {
  const API_BASE = location.origin + '/bzb_njwhd';

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

  function authHeaders() {
    let token = '';
    try { token = sessionStorage.getItem('Token') || ''; } catch (e) {}
    return { token: token };
  }

  async function postApi(path) {
    const res = await fetch(API_BASE + path, { method: 'POST', headers: authHeaders(), credentials: 'same-origin' });
    if (!res.ok) throw new Error('请求失败 ' + path + ' (' + res.status + ')');
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('接口返回非 JSON: ' + path);
    }
  }

  async function fetchAcademicOptions() {
    let html = '';
    try {
      const res = await fetch(location.origin + '/sjd/', { credentials: 'same-origin' });
      html = await res.text();
    } catch (e) {}

    const options = [];
    const seen = new Set();
    const scan = function (doc) {
      if (!doc || !doc.querySelectorAll) return;
      doc.querySelectorAll('select').forEach(function (sel) {
        const id = String(sel.id || sel.name || '').toLowerCase();
        if (!/xnm|xqm|xnd|xqd|term|xnxq|semester|学期|学年/.test(id)) return;
        Array.from(sel.options || []).forEach(function (o) {
          const text = String(o.textContent || '').trim();
          const value = o.value;
          const key = text + '|' + value;
          if (text && !seen.has(key)) {
            seen.add(key);
            options.push({ text: text, value: value, current: !!o.selected });
          }
        });
      });
    };
    try { scan(new DOMParser().parseFromString(html || '<html></html>', 'text/html')); } catch (e) {}
    try { scan(document); } catch (e) {}
    return options;
  }

  async function chooseSemester() {
    const options = await fetchAcademicOptions();
    if (!options.length) return '';
    if (options.length === 1) return options[0].value;
    const sel = ui('showSingleSelection');
    if (!sel) return '';
    const idx = options.findIndex(function (o) { return o.current; });
    const picked = await sel('选择学年学期', JSON.stringify(options.map(function (o) { return o.text; })), idx < 0 ? 0 : idx);
    if (picked === null || picked === undefined || picked === -1) return null;
    const n = Number(picked);
    return Number.isInteger(n) && options[n] ? options[n].value : null;
  }

  async function fetchTimeMode() {
    try {
      const json = await postApi('/Get_sjkbms');
      const list = Array.isArray(json.data) ? json.data : [];
      const pick = list.find(function (x) { return String(x.mrms) === '0'; }) || list[0];
      return pick ? pick.kbjcmsid : '';
    } catch (e) {
      return '';
    }
  }

  async function fetchTotalWeeks() {
    try {
      const json = await postApi('/teachingWeek');
      const ws = (Array.isArray(json.data) ? json.data : [])
        .map(function (x) { return Number(x.week); })
        .filter(function (n) { return n > 0 && n <= 30; });
      return ws.length ? Math.max.apply(null, ws) : null;
    } catch (e) {
      return null;
    }
  }

  async function fetchWholeSemester(totalWeeks, kbjcmsid) {
    const last = totalWeeks && totalWeeks > 0 ? totalWeeks : 18;
    const blocks = [];
    for (let start = 1; start <= last; start += 6) {
      const batch = [];
      for (let w = start; w < start + 6 && w <= last; w++) batch.push(w);
      const got = await Promise.all(batch.map(async function (w) {
        try {
          const json = await postApi('/student/curriculum?week=' + w + '&kbjcmsid=' + encodeURIComponent(kbjcmsid || ''));
          if (String(json.code) !== '1') return null;
          const block = json.data && json.data[0];
          return block ? { week: w, block: block } : null;
        } catch (e) {
          return null;
        }
      }));
      got.forEach(function (x) { if (x) blocks.push(x); });
    }
    return blocks;
  }

  function decodeText(value) {
    return String(value == null ? '' : value)
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  }

  function parseSections(classTime) {
    const t = String(classTime || '');
    if (!/^\d{3,}$/.test(t) || t.length % 2 === 0) return null;
    const secs = [];
    for (let i = 1; i < t.length; i += 2) {
      const n = Number(t.substr(i, 2));
      if (n > 0 && n <= 30) secs.push(n);
    }
    if (!secs.length) return null;
    return [Math.min.apply(null, secs), Math.max.apply(null, secs)];
  }

  function expandWeeks(details, raw) {
    const out = new Set();
    String(details || '').split(',').forEach(function (part) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n >= 1 && n <= 30) out.add(n);
    });
    if (!out.size) {
      String(raw || '').split(/[,，、]/).forEach(function (part) {
        const m = part.trim().match(/^(\d+)(?:\s*[-~]\s*(\d+))?$/);
        if (!m) return;
        const a = Number(m[1]);
        const b = Number(m[2] || m[1]);
        for (let i = Math.min(a, b); i <= Math.max(a, b) && i <= 30; i++) {
          if (i >= 1) out.add(i);
        }
      });
    }
    return Array.from(out).sort(function (a, b) { return a - b; });
  }

  function clock(s) {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? m[1].padStart(2, '0') + ':' + m[2] : null;
  }

  function normalizeCourses(blocks) {
    const raw = [];
    const rejected = [];
    const seenIds = new Set();
    blocks.forEach(function (item) {
      const list = (item.block && item.block.courses) || [];
      list.forEach(function (c) {
        const id = c.jx0408id || '';
        if (id && seenIds.has(id)) return;
        if (id) seenIds.add(id);

        const name = decodeText(c.courseName);
        const ct = String(c.classTime || '');
        const day = Number(c.weekDay) || (ct ? parseInt(ct.charAt(0), 10) : 0);
        const secs = parseSections(ct);
        const weeks = expandWeeks(c.classWeekDetails, c.classWeek);
        const startTime = clock(c.startTime);
        const endTime = clock(c.endTIme || c.endTime);
        const hasCustom = !!(startTime && endTime && startTime < endTime);

        if (!name || !secs || !weeks.length || !(day >= 1 && day <= 7)) {
          rejected.push(name || '(无课程名)');
          return;
        }
        const itemCourse = {
          name: name,
          teacher: decodeText(c.teacherName),
          position: decodeText(c.location || c.classroomName),
          day: day,
          startSection: secs[0],
          endSection: secs[1],
          weeks: weeks,
          isCustomTime: hasCustom
        };
        if (hasCustom) {
          itemCourse.customStartTime = startTime;
          itemCourse.customEndTime = endTime;
        }
        raw.push(itemCourse);
      });
    });

    const key1 = function (c) {
      return [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
    };
    const groups1 = new Map();
    raw.forEach(function (c) {
      const k = key1(c);
      if (!groups1.has(k)) groups1.set(k, []);
      groups1.get(k).push(c);
    });
    const stage1 = [];
    groups1.forEach(function (arr) {
      arr.sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = null;
      arr.forEach(function (c) {
        if (cur && c.startSection === cur.endSection + 1 && cur.isCustomTime === c.isCustomTime) {
          cur.endSection = c.endSection;
          if (c.customEndTime) cur.customEndTime = c.customEndTime;
        } else {
          if (cur) stage1.push(cur);
          cur = Object.assign({}, c);
        }
      });
      if (cur) stage1.push(cur);
    });

    const key2 = function (c) {
      return [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection,
        c.isCustomTime ? c.customStartTime : '', c.isCustomTime ? c.customEndTime : ''].join('|');
    };
    const groups2 = new Map();
    stage1.forEach(function (c) {
      const k = key2(c);
      if (!groups2.has(k)) groups2.set(k, c);
      else {
        const keep = groups2.get(k);
        keep.weeks = Array.from(new Set(keep.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      }
    });

    const courses = Array.from(groups2.values()).sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
    return { courses: courses, rejected: rejected };
  }

  async function runImportFlow() {
    const go = await alert('整学期课表导入', '将读取全部教学周并合并为整学期课程，是否继续？', '开始导入');
    if (!go) {
      toast('已取消，未导入');
      return;
    }

    const semester = await chooseSemester();
    if (semester === null) {
      toast('已取消，未导入');
      return;
    }

    toast('正在读取课表数据…');
    const kbjcmsid = await fetchTimeMode();
    const totalWeeks = await fetchTotalWeeks();
    const blocks = await fetchWholeSemester(totalWeeks, kbjcmsid);
    if (!blocks.length) throw new Error('没有读到课表数据，请确认已登录并打开一次课表页');

    const result = normalizeCourses(blocks);
    if (!result.courses.length) throw new Error('课程解析后为空，请检查课表页数据');

    const customCount = result.courses.filter(function (c) { return c.isCustomTime; }).length;
    const confirmed = await alert(
      '确认导入',
      '课程：' + result.courses.length + ' 门' +
        (result.rejected.length ? '\n跳过异常：' + result.rejected.length + ' 条' : '') +
        '\n周数：' + (totalWeeks || '未取到') +
        '\n时间：' + (customCount ? customCount + ' 门使用接口真实起止时间' : '使用节次默认时间') +
        '\n\n导入会覆盖当前课表。',
      '导入'
    );
    if (!confirmed) {
      toast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(result.courses));
    if (saved === false || saved === 'false') throw new Error('课程保存失败');

    let configFailed = false;
    const weekOne = blocks.find(function (x) { return x.week === 1; });
    const startDate = weekOne && weekOne.block && weekOne.block.date && weekOne.block.date[0] && weekOne.block.date[0].mxrq;
    if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && totalWeeks) {
      try {
        await BP.saveCourseConfig(JSON.stringify({
          semesterStartDate: startDate,
          semesterTotalWeeks: totalWeeks
        }));
      } catch (e) {
        configFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') BD.notifyTaskCompletion();
    toast('导入完成：' + result.courses.length + ' 门整学期课程' +
      (result.rejected.length ? '，跳过 ' + result.rejected.length + ' 条异常' : '') +
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
