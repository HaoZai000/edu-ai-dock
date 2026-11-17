// 福建农林大学（FAFU）教务适配脚本
// 使用方法：登录教务系统后直接运行即可，不需要手动进入「课表查询」页；
// 脚本会自己请求 xskbcx.aspx 并读取学年/学期下拉框。
// 若当前页面无法定位学号，请先打开一次「课表查询」页再导入。
// 修复：选择器 / 弹窗的桥签名、切换学期后的校验、取消处理、POST 隐藏域。

(async () => {
  const bridge = window.shiguangBridgePromise;
  const B = window.shiguangBridge;
  const toast = (m) => { try { B.showToast(String(m)); } catch (e) {} };
  // 真实桥签名：showAlert(标题, 内容, 确认按钮文字)
  const alertDialog = (title, content, confirmText) => bridge.showAlert(title, content, confirmText);

  // 用户提供的作息（第1-12节）
  const PRESET_TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:50', endTime: '09:35' },
    { number: 3, startTime: '09:55', endTime: '10:40' },
    { number: 4, startTime: '10:45', endTime: '11:30' },
    { number: 5, startTime: '11:35', endTime: '12:20' },
    { number: 6, startTime: '14:00', endTime: '14:45' },
    { number: 7, startTime: '14:50', endTime: '15:35' },
    { number: 8, startTime: '15:50', endTime: '16:35' },
    { number: 9, startTime: '16:40', endTime: '17:25' },
    { number: 10, startTime: '18:25', endTime: '19:10' },
    { number: 11, startTime: '19:15', endTime: '20:00' },
    { number: 12, startTime: '20:05', endTime: '20:50' }
  ];

  function absUrl(href) {
    try { return new URL(href, location.href).href; } catch (e) { return href; }
  }
  function sessionDir() {
    const m = location.pathname.match(/^\/(\([^\/]+\))\//);
    return m ? '/' + m[1] : '';
  }
  function findStudentId() {
    let m = location.search.match(/[?&]xh=(\d+)/);
    if (m) return m[1];
    const html = document.documentElement.innerHTML || '';
    m = html.match(/xh=(\d{6,})/);
    if (m) return m[1];
    const lbl = document.querySelector('#Label5, #lblStudentId');
    if (lbl) {
      const t = (lbl.textContent || '').match(/(\d{6,})/);
      if (t) return t[1];
    }
    return '';
  }
  function findCoursePageUrl() {
    const links = Array.from(document.querySelectorAll('a[href]'));
    for (const a of links) {
      const h = a.getAttribute('href') || '';
      if (/xskbcx\.aspx/i.test(h)) return absUrl(h);
    }
    const xh = findStudentId();
    return location.origin + sessionDir() + '/xskbcx.aspx?xh=' + encodeURIComponent(xh) + '&gnmkdm=N121603';
  }

  function detectCharset(buf) {
    let head = '';
    try { head = new TextDecoder('latin1').decode(buf.slice(0, 2048)); } catch (e) { head = ''; }
    const m = head.match(/charset\s*=\s*["']?([\w-]+)/i);
    if (!m) return 'utf-8';
    const cs = m[1].toLowerCase();
    if (cs === 'gb2312' || cs === 'gbk' || cs === 'gb18030') return 'gbk';
    return cs;
  }
  function decodeBuf(buf) {
    const cs = detectCharset(buf);
    try { return new TextDecoder(cs).decode(buf); }
    catch (e) {
      try { return new TextDecoder('gbk').decode(buf); }
      catch (e2) { return new TextDecoder('utf-8').decode(buf); }
    }
  }
  async function fetchText(url, opts) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {}));
    const buf = await res.arrayBuffer();
    const text = decodeBuf(buf);
    if (/name=["']?txtUserName/i.test(text) && !/xskb_form/i.test(text)) {
      throw new Error('登录状态已失效，请重新登录后重试');
    }
    return text;
  }

  function readOptions(sel) {
    if (!sel) return [];
    return Array.from(sel.options || []).map((o) => ({
      value: o.value,
      text: (o.textContent || '').trim(),
      selected: !!o.selected
    }));
  }
  function selectedValue(doc, selector) {
    const el = doc.querySelector(selector);
    if (!el || el.selectedIndex == null || el.selectedIndex < 0) return '';
    const opt = el.options[el.selectedIndex];
    return opt ? opt.value : '';
  }
  function resolveSelection(r, options, labels) {
    if (r === null || r === undefined) return -1;
    if (typeof r === 'number') return (r >= 0 && r < options.length) ? r : -1;
    if (typeof r === 'string') {
      const t = r.trim();
      let i = options.findIndex((o) => o.value === t);
      if (i >= 0) return i;
      i = labels.findIndex((l) => l === t);
      if (i >= 0) return i;
      if (/^\d+$/.test(t)) {
        const n = parseInt(t, 10);
        if (n >= 0 && n < options.length) return n;
      }
      return -1;
    }
    if (typeof r === 'object') {
      if (typeof r.index === 'number') return (r.index >= 0 && r.index < options.length) ? r.index : -1;
      if (r.value !== null && r.value !== undefined) {
        const i = options.findIndex((o) => o.value === String(r.value));
        if (i >= 0) return i;
      }
      if (r.text !== null && r.text !== undefined) {
        const i = labels.indexOf(String(r.text));
        if (i >= 0) return i;
      }
    }
    return -1;
  }
  async function choose(title, options, decorate) {
    const defIdx = Math.max(0, options.findIndex((o) => o.selected));
    const labels = options.map((o, i) => (decorate ? decorate(o, i) : o.text));
    let idx = -1;
    try {
      // 真实桥签名：showSingleSelection(标题, JSON 字符串数组, 默认下标)
      const r = await bridge.showSingleSelection(title, JSON.stringify(labels), defIdx);
      idx = resolveSelection(r, options, labels);
    } catch (e) {
      idx = -1;
    }
    // 用户取消或调用失败：返回 null，由调用方中止导入，不要拿默认值继续
    if (idx < 0) return null;
    return options[idx] || options[0];
  }

  function cellText(td) {
    let h = td.innerHTML || '';
    h = h.replace(/<br\s*\/?>/gi, '\n');
    h = h.replace(/<[^>]*>/g, '');
    h = h.replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/gi, '&');
    return h;
  }
  function cnDay(ch) {
    return { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 }[ch] || 0;
  }
  function parseWeeks(inner) {
    const s = String(inner || '').replace(/[{｝}]/g, '');
    const parts = s.split(/[|｜]/);
    const rangePart = parts[0] || '';
    const odd = /单/.test(s);
    const even = /双/.test(s);
    const set = new Set();
    let m;
    let consumed = false;
    const re = /(\d+)\s*[-~－—至]\s*(\d+)/g;
    while ((m = re.exec(rangePart))) {
      consumed = true;
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) { const t = a; a = b; b = t; }
      for (let i = a; i <= b; i++) set.add(i);
    }
    if (!consumed) {
      const re2 = /(\d+)/g;
      while ((m = re2.exec(rangePart))) set.add(parseInt(m[1], 10));
    }
    let arr = Array.from(set).filter((w) => w >= 1 && w <= 30).sort((a, b) => a - b);
    if (odd && !even) {
      const f = arr.filter((w) => w % 2 === 1);
      if (f.length) arr = f;
    } else if (even && !odd) {
      const f = arr.filter((w) => w % 2 === 0);
      if (f.length) arr = f;
    }
    return arr;
  }
  function parseSecs(str) {
    return String(str || '').split(/[,，、\s]+/).map((s) => parseInt(s, 10)).filter((n) => n > 0);
  }

  function parseBlocks(text, day, startSection, endSection) {
    const courses = [];
    const skipped = [];
    const blocks = String(text).split(/\n[ \t]*\n/);
    for (const raw of blocks) {
      const lines = raw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
      if (!lines.length) continue;
      const name = lines[0];
      if (!name) continue;
      let bday = day;
      let bs = startSection;
      let be = endSection;
      let weeks = [];
      let teacher = '';
      let position = '';
      let skipNext = false;
      for (let i = 1; i < lines.length; i++) {
        const L = lines[i];
        if (/^\d{4}\s*年\s*\d{1,2}\s*月/.test(L)) { skipNext = true; continue; }
        if (skipNext) { skipNext = false; continue; }
        const mWeek = L.match(/[\{｛]([^}｝]*)[\}｝]/);
        const mTime = L.match(/周\s*([一二三四五六日天])\s*第\s*([\d,，、\s]+?)\s*节/);
        if (mWeek || mTime) {
          if (mWeek) {
            const w = parseWeeks(mWeek[1]);
            if (w.length) weeks = weeks.concat(w);
          }
          if (mTime) {
            bday = cnDay(mTime[1]) || bday;
            const secs = parseSecs(mTime[2]);
            if (secs.length) {
              bs = Math.min.apply(null, secs);
              be = Math.max.apply(null, secs);
            }
          }
          continue;
        }
        if (!teacher) { teacher = L; continue; }
        if (!position) { position = L; continue; }
      }
      const uniqWeeks = Array.from(new Set(weeks)).sort((a, b) => a - b);
      const cleanTeacher = teacher.replace(/\([^)]*\)\s*$/, '').trim() || teacher;
      if (!uniqWeeks.length) { skipped.push(name + '(缺周次)'); continue; }
      if (!bday || bday < 1 || bday > 7) { skipped.push(name + '(缺星期)'); continue; }
      if (!bs || !be || bs < 1 || be < bs) { skipped.push(name + '(缺节次)'); continue; }
      courses.push({
        name: name,
        teacher: cleanTeacher,
        position: position,
        day: bday,
        startSection: bs,
        endSection: be,
        weeks: uniqWeeks
      });
    }
    return { courses: courses, skipped: skipped };
  }

  function parseSchedule(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#Table1');
    if (!table) return { courses: [], skipped: [] };
    const rows = Array.from(table.rows || []);
    const occ = {};
    const cells = [];
    const secOfRow = {};
    for (let r = 0; r < rows.length; r++) {
      const tds = Array.from(rows[r].cells || []);
      let c = 0;
      for (const td of tds) {
        while (occ[r + ',' + c]) c++;
        let rs = parseInt(td.getAttribute('rowspan') || '', 10);
        let cs = parseInt(td.getAttribute('colspan') || '', 10);
        if (!rs || rs < 1) rs = 1;
        if (!cs || cs < 1) cs = 1;
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) occ[(r + dr) + ',' + (c + dc)] = true;
        cells.push({ r: r, c: c, rs: rs, cs: cs, td: td });
        if (c === 1) {
          const m = cellText(td).match(/第\s*(\d+)\s*节/);
          if (m) secOfRow[r] = parseInt(m[1], 10);
        }
        c += cs;
      }
    }
    const courses = [];
    const skipped = [];
    for (const cell of cells) {
      if (cell.c < 2) continue;
      const text = cellText(cell.td).trim();
      if (!text) continue;
      const day = cell.c - 1;
      const startSection = secOfRow[cell.r];
      if (!startSection) continue;
      let endSection = secOfRow[cell.r + cell.rs - 1];
      if (!endSection) endSection = startSection + cell.rs - 1;
      const parsed = parseBlocks(text, day, startSection, endSection);
      for (const p of parsed.courses) courses.push(p);
      for (const s of parsed.skipped) skipped.push(s);
    }
    return { courses: courses, skipped: skipped };
  }

  function normalizeCourses(list) {
    const valid = [];
    const skipped = [];
    for (const c of list) {
      const name = String(c.name || '').trim();
      const day = parseInt(c.day, 10);
      const bs = parseInt(c.startSection, 10);
      const be = parseInt(c.endSection, 10);
      const weeks = Array.from(new Set((c.weeks || []).map((w) => parseInt(w, 10))))
        .filter((w) => w >= 1 && w <= 30).sort((a, b) => a - b);
      if (!name || !(day >= 1 && day <= 7) || !(bs >= 1) || !(be >= bs) || !weeks.length) {
        skipped.push(name || '(未命名)');
        continue;
      }
      valid.push({
        name: name,
        teacher: String(c.teacher || '').trim(),
        position: String(c.position || '').trim(),
        day: day,
        startSection: bs,
        endSection: be,
        weeks: weeks
      });
    }
    // 阶段1：同课同周次，节次连续则合并
    const groups = new Map();
    for (const c of valid) {
      const k = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    const stage1 = [];
    groups.forEach((arr) => {
      arr.sort((a, b) => a.startSection - b.startSection || a.endSection - b.endSection);
      let cur = null;
      for (const c of arr) {
        if (cur && c.startSection <= cur.endSection + 1) {
          cur.endSection = Math.max(cur.endSection, c.endSection);
        } else {
          if (cur) stage1.push(cur);
          cur = { name: c.name, teacher: c.teacher, position: c.position, day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice() };
        }
      }
      if (cur) stage1.push(cur);
    });
    // 阶段2：同课同节次，周次取并集
    const map2 = new Map();
    for (const c of stage1) {
      const k = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!map2.has(k)) {
        map2.set(k, { name: c.name, teacher: c.teacher, position: c.position, day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: new Set() });
      }
      const t = map2.get(k);
      c.weeks.forEach((w) => t.weeks.add(w));
    }
    const merged = [];
    map2.forEach((v) => {
      merged.push({
        name: v.name, teacher: v.teacher, position: v.position, day: v.day,
        startSection: v.startSection, endSection: v.endSection,
        weeks: Array.from(v.weeks).sort((a, b) => a - b)
      });
    });
    return { courses: merged, skipped: skipped };
  }

  function buildPostBody(doc, form, xnd, xqd) {
    const body = new URLSearchParams();
    const root = form || doc;
    const nodes = Array.from(root.querySelectorAll('input[name], select[name], textarea[name]'));
    for (const el of nodes) {
      const name = el.getAttribute('name');
      if (!name) continue;
      if (el.tagName === 'SELECT') continue; // 由下面显式覆盖
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'image' || type === 'file') continue;
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
      body.append(name, el.value == null ? '' : el.value);
    }
    body.set('__EVENTTARGET', 'xqd');
    body.set('__EVENTARGUMENT', '');
    body.set('xnd', xnd);
    body.set('xqd', xqd);
    return body;
  }

  try {
    const coursePageUrl = findCoursePageUrl();
    if (!coursePageUrl) throw new Error('找不到课表查询入口（xskbcx.aspx）');

    const html0 = await fetchText(coursePageUrl);
    const doc0 = new DOMParser().parseFromString(html0, 'text/html');
    const xnOpts = readOptions(doc0.querySelector('#xnd'));
    const xqOpts = readOptions(doc0.querySelector('#xqd'));
    if (!xnOpts.length || !xqOpts.length) {
      throw new Error('课表页没有学年/学期下拉框，可能登录已失效，请重新登录教务系统');
    }

    const xn = await choose('选择学年', xnOpts);
    if (!xn) { toast('已取消导入'); return; }
    const xq = await choose('选择学期', xqOpts, (o) => {
      const t = String(o.text || '');
      return t.indexOf('学期') >= 0 ? t : '第' + t + '学期';
    });
    if (!xq) { toast('已取消导入'); return; }

    const curXnd = (xnOpts.find((o) => o.selected) || xnOpts[0]).value;
    const curXqd = (xqOpts.find((o) => o.selected) || xqOpts[0]).value;

    let html = html0;
    if (xn.value !== curXnd || xq.value !== curXqd) {
      const form = doc0.querySelector('#xskb_form') || doc0.querySelector('form');
      const body = buildPostBody(doc0, form, xn.value, xq.value);
      const switched = await fetchText(coursePageUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
      const doc1 = new DOMParser().parseFromString(switched, 'text/html');
      const gotXnd = selectedValue(doc1, '#xnd');
      const gotXqd = selectedValue(doc1, '#xqd');
      // 切换没生效就停下：绝不拿旧学期的 HTML 冒充目标学期
      if (gotXnd !== xn.value || gotXqd !== xq.value) {
        throw new Error('切换学年/学期没有生效（当前：' + (gotXnd || '未知') + ' / ' + (gotXqd || '未知') + '），请刷新页面后重试');
      }
      html = switched;
    }

    const parsed = parseSchedule(html);
    const norm = normalizeCourses(parsed.courses);
    const allSkipped = (parsed.skipped || []).concat(norm.skipped || []);
    if (!norm.courses.length) {
      throw new Error('没有解析到任何有效课程，可能该学期无课表数据');
    }

    const rawCount = parsed.courses.length;
    const proceed = await alertDialog(
      '确认导入',
      '将从 ' + xn.text + ' 学年第' + xq.text + '学期导入 ' + norm.courses.length +
        ' 门课程（解析到 ' + rawCount + ' 条记录）',
      '开始导入'
    );
    if (proceed === false) { toast('已取消导入'); return; }

    await bridge.saveImportedCourses(JSON.stringify(norm.courses));
    let timeSlotError = '';
    try {
      await bridge.savePresetTimeSlots(JSON.stringify(PRESET_TIME_SLOTS));
    } catch (e) {
      timeSlotError = (e && e.message) ? e.message : String(e);
    }

    let msg = '导入完成：' + norm.courses.length + ' 门课程' +
      (timeSlotError ? '；作息保存失败：' + timeSlotError : '，作息 ' + PRESET_TIME_SLOTS.length + ' 节');
    if (allSkipped.length) msg += '；跳过 ' + allSkipped.length + ' 项：' + allSkipped.slice(0, 5).join('、');
    toast(msg);
    try { await alertDialog('导入完成', msg, '知道了'); } catch (e) {}
    try { B.notifyTaskCompletion(); } catch (e) {}
  } catch (err) {
    const m = (err && err.message) ? err.message : String(err);
    try { await alertDialog('导入失败', m, '知道了'); } catch (e) {}
    toast('导入失败：' + m);
  }
})();
