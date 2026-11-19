(async function () {
  const origin = location.origin;
  const PAGE_URL = origin + '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
  const KB_URL = origin + '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const RJC_URL = origin + '/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

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

  function postForm(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body
    }).then(function (r) {
      if (!r.ok) throw new Error('接口 HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      try { return JSON.parse(t); } catch (e) { throw new Error('接口返回不是 JSON，登录可能已失效'); }
    });
  }

  // 1. 学年 / 学期选择器：从课表查询页解析 option，默认项取页面当前选中值
  async function fetchAcademicOptions() {
    const r = await fetch(PAGE_URL, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('课表查询页 HTTP ' + r.status);
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    function readSelect(id) {
      const sel = doc.querySelector('#' + id);
      if (!sel) return null;
      const opts = Array.from(sel.querySelectorAll('option'));
      const items = [];
      opts.forEach(function (o) {
        const v = (o.value || '').trim();
        if (v) items.push({ value: v, text: (o.textContent || '').trim() });
      });
      if (!items.length) return null;
      // 当前浏览器里若就是课表页，优先取实时选中值；否则用服务端 HTML 的 selected
      let current = '';
      const live = document.querySelector('#' + id);
      if (live && live.value) current = live.value;
      if (!current) {
        const selOpt = opts.find(function (o) { return o.selected && o.value && o.value.trim(); });
        if (selOpt) current = selOpt.value.trim();
      }
      let def = 0;
      const idx = items.findIndex(function (i) { return i.value === current; });
      if (idx >= 0) def = idx;
      return { items: items, def: def };
    }
    return { years: readSelect('xnm'), terms: readSelect('xqm') };
  }

  async function chooseSemester() {
    const opt = await fetchAcademicOptions();
    if (!opt.years || !opt.terms) throw new Error('没有解析到学年/学期下拉框，请确认已登录教务系统');
    let yi = 0;
    if (opt.years.items.length > 1) {
      const picked = await pick('选择学年', opt.years.items.map(function (i) { return i.text; }), opt.years.def);
      if (picked === null || picked === undefined || picked < 0) return null;
      yi = picked;
    }
    let ti = 0;
    if (opt.terms.items.length > 1) {
      const picked = await pick('选择学期', opt.terms.items.map(function (i) { return i.text; }), opt.terms.def);
      if (picked === null || picked === undefined || picked < 0) return null;
      ti = picked;
    }
    const y = opt.years.items[yi], t = opt.terms.items[ti];
    if (!y || !t) return null;
    return { xnm: y.value, xqm: t.value, label: y.text + ' ' + t.text };
  }

  // 2. 作息：来自 xskbcx_cxRjc 接口，按数组顺序即第 1..N 节
  async function fetchTimeSlots(xqhId, xnm, xqm) {
    const body = 'xnm=' + encodeURIComponent(xnm) + '&xqm=' + encodeURIComponent(xqm) + '&xqh_id=' + encodeURIComponent(xqhId || '');
    const r = await postForm(RJC_URL, body);
    const list = Array.isArray(r) ? r : ((r && (r.items || r.jcList || r.list)) || []);
    if (!Array.isArray(list) || !list.length) return [];
    const slots = [];
    list.forEach(function (t, i) {
      const s = String((t && t.qssj) || '').trim();
      const e = String((t && t.jssj) || '').trim();
      if (/^\d{1,2}:\d{2}$/.test(s) && /^\d{1,2}:\d{2}$/.test(e)) {
        slots.push({ number: i + 1, startTime: s, endTime: e });
      }
    });
    return slots;
  }

  // 3. 周次 / 节次解析
  function expandWeeks(zcd) {
    if (!zcd) return [];
    const s = String(zcd);
    const onlyOdd = /单/.test(s), onlyEven = /双/.test(s);
    const out = [];
    s.split(/[,，、;；]/).forEach(function (part) {
      const nums = part.match(/\d+/g);
      if (!nums || !nums.length) return;
      let a = parseInt(nums[0], 10);
      let b = nums.length > 1 ? parseInt(nums[1], 10) : a;
      if (isNaN(a) || isNaN(b)) return;
      if (b < a) { const t = a; a = b; b = t; }
      for (let w = a; w <= b; w++) {
        if (onlyOdd && !onlyEven && w % 2 === 0) continue;
        if (onlyEven && !onlyOdd && w % 2 === 1) continue;
        out.push(w);
      }
    });
    return Array.from(new Set(out)).filter(function (w) { return w >= 1 && w <= 30; }).sort(function (a, b) { return a - b; });
  }

  function parseSections(it) {
    const s = String(it.jcs || it.jc || it.jcor || '');
    const nums = (s.match(/\d+/g) || []).map(Number).filter(function (n) { return !isNaN(n); });
    if (!nums.length) return null;
    return [Math.min.apply(null, nums), Math.max.apply(null, nums)];
  }

  function normalizeCourses(list) {
    const valid = [];
    let bad = 0;
    (list || []).forEach(function (it) {
      const name = String(it.kcmc || '').trim();
      const day = parseInt(it.xqj, 10);
      const sec = parseSections(it);
      const weeks = expandWeeks(it.zcd);
      if (!name || !(day >= 1 && day <= 7) || !sec || !(sec[0] >= 1 && sec[1] >= sec[0] && sec[1] <= 25) || !weeks.length) {
        bad++;
        return;
      }
      valid.push({
        name: name,
        position: String(it.cdmc || '').trim(),
        teacher: String(it.xm || '').trim(),
        day: day,
        startSection: sec[0],
        endSection: sec[1],
        weeks: weeks
      });
    });

    function idOf(c) { return [c.name, c.teacher, c.position, c.day].join('\u0001'); }
    function weekKey(c) { return c.weeks.slice().sort(function (a, b) { return a - b; }).join(','); }

    // 阶段一：同课同周次且节次连续（1-2 + 3-4 -> 1-4）
    const byWeek = {};
    valid.forEach(function (c) {
      const k = idOf(c) + '|' + weekKey(c);
      (byWeek[k] = byWeek[k] || []).push(c);
    });
    const merged = [];
    Object.keys(byWeek).forEach(function (k) {
      const g = byWeek[k].slice().sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = null;
      g.forEach(function (c) {
        if (cur && c.startSection === cur.endSection + 1) {
          cur.endSection = c.endSection;
        } else {
          if (cur) merged.push(cur);
          cur = { name: c.name, position: c.position, teacher: c.teacher, day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice() };
        }
      });
      if (cur) merged.push(cur);
    });

    // 阶段二：同课同节次，周次取并集
    const bySec = {};
    merged.forEach(function (c) {
      const k = idOf(c) + '|' + c.startSection + '-' + c.endSection;
      (bySec[k] = bySec[k] || []).push(c);
    });
    const final = [];
    Object.keys(bySec).forEach(function (k) {
      const g = bySec[k];
      const set = {};
      g.forEach(function (c) { c.weeks.forEach(function (w) { set[w] = 1; }); });
      const base = g[0];
      final.push({
        name: base.name,
        position: base.position,
        teacher: base.teacher,
        day: base.day,
        startSection: base.startSection,
        endSection: base.endSection,
        weeks: Object.keys(set).map(Number).sort(function (a, b) { return a - b; })
      });
    });
    return { courses: final, bad: bad };
  }

  // 4. 主流程
  async function runImportFlow() {
    const go = await alertBox('课表导入', '将从正方教务读取所选学期的整学期课表并导入', '开始导入');
    if (go === false) { await toast('已取消，未导入'); return; }

    const sem = await chooseSemester();
    if (!sem) { await toast('已取消，未导入'); return; }

    const body = 'xnm=' + encodeURIComponent(sem.xnm) + '&xqm=' + encodeURIComponent(sem.xqm) + '&kzlx=ck&xsdm=';
    const data = await postForm(KB_URL, body);
    if (data && (data.xnxqsfkz === true || data.xnxqsfkz === 'true')) throw new Error('该学期课表当前时间段不允许查看');
    const kbList = (data && data.kbList) || [];
    if (!kbList.length) { await toast(sem.label + ' 没有课表数据，请重新选择学期'); return; }

    const xqhId = (kbList[0] && kbList[0].xqh_id) || '';
    let slots = [];
    try { slots = await fetchTimeSlots(xqhId, sem.xnm, sem.xqm); } catch (e) { slots = []; }

    const result = normalizeCourses(kbList);
    if (!result.courses.length) { await toast('没有解析到可用课程，导入中止'); return; }

    const saved = await save('saveImportedCourses', JSON.stringify(result.courses));
    if (saved === false || saved === null || saved === undefined) throw new Error('课程保存失败');

    if (slots.length) {
      try {
        const slotsSaved = await save('savePresetTimeSlots', JSON.stringify(slots));
        if (slotsSaved === false || slotsSaved === null || slotsSaved === undefined) {
          await toast('作息保存失败，课程已导入');
        }
      } catch (_) {
        await toast('作息保存失败，课程已导入');
      }
    }

    await toast('已导入 ' + result.courses.length + ' 门课' + (result.bad ? '，跳过 ' + result.bad + ' 条异常数据' : '') + (slots.length ? '，并写入 ' + slots.length + ' 节作息' : ''));
    if (BR && typeof BR.notifyTaskCompletion === 'function') BR.notifyTaskCompletion();
  }

  runImportFlow().catch(function (e) {
    alertBox('导入失败', (e && e.message) || String(e), '知道了').catch(function () { });
  });
})();
