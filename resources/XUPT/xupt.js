// 西安邮电大学（XUPT）正方教务课表适配器
// 使用方法：登录教务系统后直接运行，不需要手动进入「课表查询」页；
// 脚本会自己请求整学期课表与节次作息。若当前页面不是教务系统页面，请先打开一次。

(async () => {
  const BASE = location.origin;
  const PAGE_URL = BASE + '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
  const KB_URL = BASE + '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const RJC_URL = BASE + '/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

  const bridge = (typeof window !== 'undefined' && window.shiguangBridge) ||
    (typeof shiguangBridge !== 'undefined' ? shiguangBridge : null);
  const bp = (typeof shiguangBridgePromise !== 'undefined' && shiguangBridgePromise) ||
    (typeof window !== 'undefined' ? window.shiguangBridgePromise : null);

  function formBody(params) {
    return Object.keys(params).map((k) =>
      encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k])
    ).join('&');
  }

  async function post(url, params) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: formBody(params)
    });
    if (!res.ok) throw new Error('请求失败 ' + res.status + ' ' + url);
    return res.json();
  }

  // 读取学年 / 学期下拉框选项
  async function fetchAcademicOptions() {
    const res = await fetch(PAGE_URL, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('课表查询页打开失败 ' + res.status);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    function read(sel) {
      const out = { items: [], def: 0 };
      if (!sel) return out;
      Array.prototype.forEach.call(sel.options, (o) => {
        if (!o.value) return;
        out.items.push({ value: o.value, text: (o.textContent || '').trim() });
        if (o.selected) out.def = out.items.length - 1;
      });
      return out;
    }
    const years = read(doc.querySelector('#xnm'));
    const terms = read(doc.querySelector('#xqm'));
    if (!years.items.length || !terms.items.length) {
      throw new Error('页面上找不到学年/学期下拉框');
    }
    return { years, terms };
  }

  async function uiSelect(title, items, def) {
    let r = null;
    if (bp && typeof bp.showSingleSelection === 'function') {
      r = await bp.showSingleSelection(title, JSON.stringify(items), def);
    } else if (typeof window !== 'undefined' && typeof window.showSingleSelection === 'function') {
      r = await window.showSingleSelection(title, JSON.stringify(items), def);
    } else if (bridge && typeof bridge.showSingleSelection === 'function') {
      r = await bridge.showSingleSelection(title, JSON.stringify(items), def);
    }
    if (r === null || r === -1 || typeof r !== 'number') return null;
    return r;
  }

  async function chooseSemester(opts) {
    const yi = await uiSelect('选择学年', opts.years.items.map((x) => x.text), opts.years.def);
    if (yi === null) return null;
    const ti = await uiSelect(
      '选择学期',
      opts.terms.items.map((x) => '第' + x.text + '学期'),
      opts.terms.def
    );
    if (ti === null) return null;
    return {
      xnm: opts.years.items[yi].value,
      xqm: opts.terms.items[ti].value,
      label: opts.years.items[yi].text + ' 第' + opts.terms.items[ti].text + '学期'
    };
  }

  // 整学期课表
  async function fetchCourses(sel) {
    const data = await post(KB_URL, {
      xnm: sel.xnm,
      xqm: sel.xqm,
      kzlx: 'ck',
      xsdm: '',
      kclbdm: '',
      kclxdm: ''
    });
    const kb = (data && data.kbList) || [];
    return kb.map((x) => {
      let pos = String(x.cdmc || '').trim();
      if (!pos || pos === '未排地点' || pos === '无楼号' || pos === '无') pos = '';
      return {
        name: String(x.kcmc || '').trim(),
        position: pos,
        teacher: String(x.xm || '').trim(),
        day: parseInt(x.xqj, 10),
        jcor: String(x.jcor || x.jc || x.jcs || ''),
        zcd: String(x.zcd || '')
      };
    });
  }

  // 节次作息
  async function fetchTimeSlots(sel) {
    const data = await post(RJC_URL, { xnm: sel.xnm, xqm: sel.xqm });
    const arr = Array.isArray(data) ? data : [];
    return arr.map((x) => ({
      number: parseInt(x.jcmc, 10),
      startTime: x.qssj,
      endTime: x.jssj
    })).filter((t) =>
      t.number >= 1 &&
      /^\d{1,2}:\d{2}$/.test(t.startTime) &&
      /^\d{1,2}:\d{2}$/.test(t.endTime)
    ).sort((a, b) => a.number - b.number);
  }

  function parseSections(s) {
    const m = String(s || '').match(/(\d+)\s*[-~至]\s*(\d+)|(\d+)/);
    if (!m) return null;
    const a = m[1] ? parseInt(m[1], 10) : parseInt(m[3], 10);
    const b = m[1] ? parseInt(m[2], 10) : a;
    return { start: a, end: b };
  }

  function parseWeeks(s) {
    const str = String(s || '');
    const odd = /单/.test(str);
    const even = /双/.test(str);
    const set = {};
    const re = /(\d+)\s*(?:-|至)\s*(\d+)|(\d+)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const a = m[1] ? parseInt(m[1], 10) : parseInt(m[3], 10);
      const b = m[1] ? parseInt(m[2], 10) : a;
      for (let w = a; w <= b && w <= 30; w++) {
        if (odd && w % 2 === 0) continue;
        if (even && w % 2 === 1) continue;
        set[w] = 1;
      }
    }
    return Object.keys(set).map(Number).sort((a, b) => a - b);
  }

  function keyBase(c) {
    return [c.name, c.teacher, c.position, c.day].join('\u0001');
  }
  function weeksKey(c) {
    return c.weeks.join(',');
  }

  function normalizeCourses(raw) {
    const valid = [];
    let skipped = 0;
    raw.forEach((x) => {
      const sec = parseSections(x.jcor);
      const weeks = parseWeeks(x.zcd);
      if (!x.name || !(x.day >= 1 && x.day <= 7) || !sec || sec.start < 1 ||
        sec.end < sec.start || !weeks.length) {
        skipped++;
        return;
      }
      valid.push({
        name: x.name,
        position: x.position,
        teacher: x.teacher,
        day: x.day,
        startSection: sec.start,
        endSection: sec.end,
        weeks: weeks
      });
    });
    // 阶段一：同课同周次、节次连续 -> 合并节次
    const stage1 = [];
    valid.forEach((c) => {
      let done = false;
      for (let i = 0; i < stage1.length; i++) {
        const m = stage1[i];
        if (keyBase(m) === keyBase(c) && weeksKey(m) === weeksKey(c)) {
          if (m.endSection + 1 === c.startSection) {
            m.endSection = c.endSection;
            done = true;
            break;
          }
          if (c.endSection + 1 === m.startSection) {
            m.startSection = c.startSection;
            done = true;
            break;
          }
        }
      }
      if (!done) {
        stage1.push({
          name: c.name,
          position: c.position,
          teacher: c.teacher,
          day: c.day,
          startSection: c.startSection,
          endSection: c.endSection,
          weeks: c.weeks.slice()
        });
      }
    });
    // 阶段二：同课同节次 -> 周次取并集
    const map = {};
    const order = [];
    stage1.forEach((c) => {
      const k = keyBase(c) + '\u0001' + c.startSection + '-' + c.endSection;
      if (map[k]) {
        const union = {};
        map[k].weeks.concat(c.weeks).forEach((w) => { union[w] = 1; });
        map[k].weeks = Object.keys(union).map(Number).sort((a, b) => a - b);
      } else {
        map[k] = c;
        order.push(k);
      }
    });
    return { courses: order.map((k) => map[k]), skipped };
  }

  async function uiAlert(title, msg, btn) {
    if (bp && typeof bp.showAlert === 'function') {
      return await bp.showAlert(title, msg, btn);
    }
    if (typeof window !== 'undefined' && typeof window.showAlert === 'function') {
      return await window.showAlert(title, msg, btn);
    }
    return true;
  }

  async function toast(msg) {
    if (bridge && typeof bridge.showToast === 'function') return bridge.showToast(msg);
    if (bp && typeof bp.showToast === 'function') return bp.showToast(msg);
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      return window.showToast(msg);
    }
  }

  async function runImportFlow() {
    try {
      const ok = await uiAlert(
        '教务课表导入',
        '将读取个人课表接口的整学期课程与节次作息，继续吗？',
        '继续'
      );
      if (ok === false) {
        await toast('已取消导入');
        return;
      }
      const opts = await fetchAcademicOptions();
      const sel = await chooseSemester(opts);
      if (!sel) {
        await toast('已取消导入');
        return;
      }
      const results = await Promise.all([
        fetchCourses(sel).catch((e) => ({ error: e })),
        fetchTimeSlots(sel).catch((e) => ({ error: e }))
      ]);
      if (results[0] && results[0].error) throw results[0].error;
      const result = normalizeCourses(results[0]);
      if (!result.courses.length) throw new Error('整学期课表为空，未导入');
      await bp.saveImportedCourses(JSON.stringify(result.courses));
      const slots = (results[1] && results[1].error) ? [] : (results[1] || []);
      if (slots.length) await bp.savePresetTimeSlots(JSON.stringify(slots));
      await toast('已导入 ' + result.courses.length + ' 门课（' + sel.label + '）' +
        (result.skipped ? '，跳过 ' + result.skipped + ' 条无效记录' : ''));
      if (bridge && typeof bridge.notifyTaskCompletion === 'function') {
        bridge.notifyTaskCompletion();
      }
    } catch (err) {
      await toast('导入失败：' + (err && err.message ? err.message : String(err)));
    }
  }

  runImportFlow();
})();
