(async function () {
  const BASE = location.origin;
  const BP = window.shiguangBridgePromise || null;
  const BR = window.shiguangBridge || null;

  async function toast(msg) {
    try {
      if (BR && typeof BR.showToast === 'function') return await BR.showToast(msg);
      if (BP && typeof BP.showToast === 'function') return await BP.showToast(msg);
    } catch (_) { }
  }

  async function alertBox(title, msg, btn) {
    if (BP && typeof BP.showAlert === 'function') return await BP.showAlert(title, msg, btn);
    if (typeof window.showAlert === 'function') return await window.showAlert(title, msg, btn);
    return true;
  }

  async function pick(title, options, def) {
    if (BP && typeof BP.showSingleSelection === 'function') {
      return await BP.showSingleSelection(title, JSON.stringify(options), def);
    }
    if (typeof window.showSingleSelection === 'function') {
      return await window.showSingleSelection(title, JSON.stringify(options), def);
    }
    throw new Error('当前环境没有选择器，无法选择学期');
  }

  async function save(name, payload) {
    if (BP && typeof BP[name] === 'function') return await BP[name](payload);
    throw new Error('当前环境缺少保存方法：' + name);
  }

  function stripTags(s) {
    const d = document.createElement('div');
    d.innerHTML = s == null ? '' : String(s);
    return (d.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  async function reqText(path, method, body, gbk) {
    const opt = { method: method || 'GET', credentials: 'include' };
    if (body != null) { opt.body = body; opt.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
    const r = await fetch(BASE + path, opt);
    if (!r.ok) throw new Error('接口 HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    return new TextDecoder(gbk ? 'gbk' : 'utf-8').decode(buf);
  }

  async function fetchAcademicOptions() {
    let xn = '', xq = '0', xh = '';
    try {
      const j = JSON.parse(await reqText('/jw/common/showYearTerm.action', 'POST', ''));
      xn = j.xn || '';
      xq = String(j.xqM || '0');
      xh = j.userCode || '';
    } catch (e) { }
    let arr = [];
    try {
      arr = JSON.parse(await reqText('/frame/droplist/getDropLists.action', 'POST', 'comboBoxName=StMsXnxqDxDesc&paramValue=&isYXB=0&isCDDW=0&isXQ=0&isDJKSLB=0&isZY=0'));
    } catch (e) { }
    const opts = (Array.isArray(arr) ? arr : []).map(function (o) {
      return { code: String(o.code), name: String(o.name) };
    });
    if (!xh) {
      try {
        const h = await reqText('/student/xkjg.wdkb.jsp?menucode=S20301', 'GET', null, true);
        const m = h.match(/id="xh"[^>]*value="([^"]+)"/) || h.match(/value="([^"]+)"[^>]*id="xh"/);
        if (m) xh = m[1];
      } catch (e) { }
    }
    if (!xn && !opts.length) throw new Error('没取到学年学期，登录可能已失效');
    if (!xh) throw new Error('没取到学号，登录可能已失效');
    let def = 0;
    const cur = xn + '-' + xq;
    const i = opts.findIndex(function (o) { return o.code === cur; });
    if (i >= 0) def = i;
    if (!opts.length && xn) opts.push({ code: xn + '-' + xq, name: xn + '学年 第' + xq + '学期' });
    return { opts: opts, def: def, xh: xh, xn: xn, xq: xq };
  }

  // 学期 code 可能是「2025-2026-1」或「2025-1」，学年要保留完整范围
  function splitCode(code, fallbackXn, fallbackXq) {
    const parts = String(code || '').split('-').filter(function (x) { return x !== ''; });
    if (parts.length >= 3) {
      return { xn: parts.slice(0, parts.length - 1).join('-'), xq: parts[parts.length - 1] };
    }
    if (parts.length === 2) return { xn: parts[0], xq: parts[1] };
    return { xn: fallbackXn, xq: fallbackXq };
  }

  async function chooseSemester(ac) {
    let code;
    if (ac.opts.length > 1) {
      const names = ac.opts.map(function (o) { return o.name; });
      const sel = await pick('选择学年学期', names, ac.def);
      if (sel == null || sel < 0 || !ac.opts[sel]) return null;
      code = ac.opts[sel].code;
    } else {
      code = ac.opts[ac.def] ? ac.opts[ac.def].code : (ac.xn + '-' + ac.xq);
    }
    return splitCode(code, ac.xn, ac.xq);
  }

  function expandWeeks(raw, parity) {
    const s = String(raw == null ? '' : raw).replace(/周/g, '');
    const out = [];
    s.split(/[,，、;；]/).forEach(function (part) {
      const nums = part.match(/\d+/g);
      if (!nums || !nums.length) return;
      let a = parseInt(nums[0], 10);
      let b = nums.length > 1 ? parseInt(nums[1], 10) : a;
      if (isNaN(a) || isNaN(b)) return;
      if (b < a) { const t = a; a = b; b = t; }
      for (let w = a; w <= b; w++) {
        if (parity === '单' && w % 2 === 0) continue;
        if (parity === '双' && w % 2 === 1) continue;
        out.push(w);
      }
    });
    return Array.from(new Set(out)).filter(function (w) { return w >= 1 && w <= 30; }).sort(function (x, y) { return x - y; });
  }

  function parseCourseDiv(div, day) {
    const parts = div.innerHTML.split(/<br\s*\/?>/i).map(stripTags);
    if (parts.length < 2) return null;
    const name = (parts[0] || '').replace(/\[[^\]]*\]/g, '').trim();
    if (!name) return null;
    // 教师可能为空，按「含节次的那一行」定位时间，避免固定下标错位
    let timeIdx = -1;
    for (let i = 1; i < parts.length; i++) {
      if (/\[\s*\d+\s*-\s*\d+\s*节?\s*\]/.test(parts[i])) { timeIdx = i; break; }
    }
    if (timeIdx < 0) return null;
    const teacher = timeIdx >= 2 ? (parts[1] || '').trim() : '';
    const timeStr = parts[timeIdx] || '';
    const position = (parts[timeIdx + 1] || '').replace(/\s+/g, ' ').trim();
    const sm = timeStr.match(/\[(\d+)\s*-\s*(\d+)\s*节?\]/);
    if (!sm) return null;
    const startSection = parseInt(sm[1], 10), endSection = parseInt(sm[2], 10);
    const parity = /单/.test(timeStr) ? '单' : (/双/.test(timeStr) ? '双' : '');
    const raw = timeStr.replace(/\[[^\]]*\]/, '').replace(/[单双]/g, '').trim();
    const weeks = expandWeeks(raw, parity);
    if (!weeks.length) return null;
    return { name: name, teacher: teacher, position: position, day: day, startSection: startSection, endSection: endSection, weeks: weeks };
  }

  async function fetchCourses(xn, xq, xh) {
    const params = 'xn=' + xn + '&xq=' + xq + '&xh=' + xh;
    const url = '/student/wsxk.xskcb10319.jsp?params=' + encodeURIComponent(btoa(params));
    const html = await reqText(url, 'GET', null, true);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#mytable') || doc.querySelector('table.table');
    if (!table) throw new Error('未找到课表表格，登录可能已失效');
    const list = [];
    Array.from(table.querySelectorAll('tr')).forEach(function (tr) {
      if ((tr.className || '').indexOf('H') >= 0) return;
      const tds = Array.from(tr.children).filter(function (e) { return e.tagName === 'TD'; });
      if (tds.length < 8) return;
      const weekTds = tds.slice(-7);
      weekTds.forEach(function (td, idx) {
        const day = idx + 1;
        Array.from(td.querySelectorAll('div')).forEach(function (div) {
          const cn = div.className || '';
          if (cn.indexOf('div_nokb') >= 0) return;
          if (!(div.innerHTML || '').trim() || !(div.textContent || '').trim()) return;
          const c = parseCourseDiv(div, day);
          if (c) list.push(c);
        });
      });
    });
    return list;
  }

  async function fetchTimeSlots(xn, xq) {
    const url = '/frame/desk/showLessonScheduleInfosV14.action?xn=' + xn + '&xq=' + xq + '&jxz=1';
    const html = await reqText(url, 'POST', '');
    const slots = [];
    const re = /(\d+)\s*\(\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*\)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      slots.push({ number: parseInt(m[1], 10), startTime: m[2], endTime: m[3] });
    }
    slots.sort(function (a, b) { return a.number - b.number; });
    let startDate = null;
    const dm = html.match(/一<br>\s*(\d{2})-(\d{2})/);
    if (dm) {
      const ym = String(xn).match(/(\d{4})/);
      const startYear = ym ? parseInt(ym[1], 10) : new Date().getFullYear();
      const month = parseInt(dm[1], 10);
      // 8-12 月属于起始年，1-7 月属于次年
      const year = month >= 8 ? startYear : startYear + 1;
      startDate = year + '-' + dm[1] + '-' + dm[2];
    }
    return { slots: slots, startDate: startDate };
  }

  function normalizeCourses(list) {
    const valid = [];
    let skipped = 0;
    list.forEach(function (c) {
      const ok = c.name && Number.isInteger(c.day) && c.day >= 1 && c.day <= 7
        && Number.isInteger(c.startSection) && c.startSection >= 1 && c.startSection <= 20
        && Number.isInteger(c.endSection) && c.endSection >= c.startSection && c.endSection <= 20
        && Array.isArray(c.weeks) && c.weeks.length > 0;
      if (ok) valid.push(c); else skipped++;
    });
    const k1 = function (c) { return [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|'); };
    const s1 = [];
    valid.forEach(function (c) {
      const k = k1(c);
      let f = s1.find(function (x) { return k1(x) === k && x.endSection + 1 === c.startSection; });
      if (f) { f.endSection = c.endSection; return; }
      f = s1.find(function (x) { return k1(x) === k && c.endSection + 1 === x.startSection; });
      if (f) { f.startSection = c.startSection; return; }
      s1.push({ name: c.name, teacher: c.teacher, position: c.position, day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice() });
    });
    const k2 = function (c) { return [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|'); };
    const merged = [];
    s1.forEach(function (c) {
      const f = merged.find(function (x) { return k2(x) === k2(c); });
      if (f) { f.weeks = Array.from(new Set(f.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; }); }
      else merged.push(c);
    });
    return { courses: merged, skipped: skipped };
  }

  async function runImportFlow() {
    const go = await alertBox('教务导入', '将从个人课表读取整学期课程并导入，是否继续？', '开始导入');
    if (go === false) { await toast('已取消，未导入'); return; }

    const ac = await fetchAcademicOptions();
    const sem = await chooseSemester(ac);
    if (!sem) { await toast('已取消，未导入'); return; }

    const results = await Promise.allSettled([
      fetchCourses(sem.xn, sem.xq, ac.xh),
      fetchTimeSlots(sem.xn, sem.xq)
    ]);
    if (results[0].status !== 'fulfilled') {
      throw new Error('课程读取失败：' + ((results[0].reason && results[0].reason.message) || ''));
    }
    const raw = results[0].value;
    const time = results[1].status === 'fulfilled' ? results[1].value : { slots: [], startDate: null };
    const out = normalizeCourses(raw);
    if (!out.courses.length) throw new Error('未解析到有效课程，请确认所选学期是否有课表');

    const saved = await save('saveImportedCourses', JSON.stringify(out.courses));
    if (saved === false || saved === null || saved === undefined) throw new Error('课程保存失败');

    if (time.startDate) {
      try {
        const cfgSaved = await save('saveCourseConfig', JSON.stringify({ semesterStartDate: time.startDate }));
        if (cfgSaved === false || cfgSaved === null || cfgSaved === undefined) await toast('开学日期保存失败，课程已导入');
      } catch (_) {
        await toast('开学日期保存失败，课程已导入');
      }
    }
    if (time.slots.length) {
      try {
        const slotsSaved = await save('savePresetTimeSlots', JSON.stringify(time.slots));
        if (slotsSaved === false || slotsSaved === null || slotsSaved === undefined) await toast('作息保存失败，课程已导入');
      } catch (_) {
        await toast('作息保存失败，课程已导入');
      }
    }

    await toast('已导入 ' + out.courses.length + ' 门课程' + (out.skipped ? '，跳过 ' + out.skipped + ' 条异常' : ''));
    if (BR && typeof BR.notifyTaskCompletion === 'function') BR.notifyTaskCompletion();
  }

  runImportFlow().catch(function (e) {
    alertBox('导入失败', (e && e.message) || String(e), '知道了').catch(function () { });
  });
})();
