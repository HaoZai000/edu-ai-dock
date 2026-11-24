// 河北建筑工程学院（强智教务）整学期课表适配器
(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BD = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  const ORIGIN = location.origin;
  const G = 'N253508';
  const URL_INDEX = ORIGIN + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=' + G + '&layout=default';
  const URL_KB = ORIGIN + '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=' + G;
  const URL_JC = ORIGIN + '/kbcx/xskbcx_cxRjc.html?gnmkdm=' + G;
  const HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest'
  };

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

  async function postForm(url, params) {
    const body = new URLSearchParams();
    Object.keys(params).forEach(function (k) { body.append(k, params[k] == null ? '' : params[k]); });
    const res = await fetch(url, { method: 'POST', credentials: 'include', headers: HEADERS, body: body.toString() });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.indexOf('html') >= 0) throw new Error('登录状态可能已失效，请重新登录教务系统后再试');
    if (!res.ok) throw new Error('请求失败 HTTP ' + res.status);
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('接口返回不是 JSON，可能登录已失效'); }
  }

  function readOptions(el, live) {
    if (!el) return [];
    const out = [];
    const list = el.querySelectorAll('option');
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const v = o.value == null ? '' : String(o.value).trim();
      if (v === '') continue;
      const selected = live ? String(el.value).trim() === v : o.hasAttribute('selected');
      out.push({ value: v, text: (o.textContent || '').trim(), selected: selected });
    }
    return out;
  }

  async function loadOptions() {
    // 优先读当前页面上已经渲染好的下拉框（用户当前所在学期最准）
    try {
      if (typeof document !== 'undefined' && document.querySelector) {
        const xn = document.querySelector('select[name="xnm"]') || document.querySelector('#xnm');
        const xq = document.querySelector('select[name="xqm"]') || document.querySelector('#xqm');
        const a = readOptions(xn, true);
        const b = readOptions(xq, true);
        if (a.length && b.length) return { xnm: a, xqm: b };
      }
    } catch (e) { /* 回退到请求页面 */ }
    const res = await fetch(URL_INDEX, { credentials: 'include' });
    if (!res.ok) throw new Error('课表查询页请求失败：HTTP ' + res.status);
    const html = await res.text();
    if (!html || html.indexOf('<select') < 0) throw new Error('无法读取课表查询页，请确认已登录教务系统');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const a = readOptions(doc.querySelector('select[name="xnm"]') || doc.querySelector('#xnm'), false);
    const b = readOptions(doc.querySelector('select[name="xqm"]') || doc.querySelector('#xqm'), false);
    if (!a.length) throw new Error('课表查询页未找到学年下拉框，页面结构可能已变化');
    if (!b.length) throw new Error('课表查询页未找到学期下拉框，页面结构可能已变化');
    return { xnm: a, xqm: b };
  }

  function fetchKb(xnm, xqm) {
    return postForm(URL_KB, { xnm: xnm, xqm: xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' });
  }

  async function fetchTimeSlots(xnm, xqm, xqhId) {
    if (!xqhId) return null;
    const data = await postForm(URL_JC, { xnm: xnm, xqm: xqm, xqh_id: xqhId });
    if (!Array.isArray(data)) return null;
    const slots = [];
    for (let i = 0; i < data.length; i++) {
      const it = data[i] || {};
      const n = parseInt(it.jcmc, 10);
      const st = String(it.qssj || '').slice(0, 5);
      const et = String(it.jssj || '').slice(0, 5);
      if (!n || !/^\d{2}:\d{2}$/.test(st) || !/^\d{2}:\d{2}$/.test(et)) continue;
      slots.push({ number: n, startTime: st, endTime: et });
    }
    slots.sort(function (a, b) { return a.number - b.number; });
    return slots.length ? slots : null;
  }

  function parseWeeks(zcd) {
    const seen = {};
    if (!zcd) return [];
    const text = String(zcd).replace(/（/g, '(').replace(/）/g, ')');
    const parts = text.split(/[,，;；]/);
    for (let i = 0; i < parts.length; i++) {
      let seg = (parts[i] || '').trim();
      if (!seg) continue;
      const odd = seg.indexOf('单') >= 0;
      const even = seg.indexOf('双') >= 0;
      seg = seg.replace(/第/g, '').replace(/周/g, '').replace(/\((单|双)\)/g, '').replace(/单|双/g, '').trim();
      const range = seg.match(/^(\d+)\s*[-~至到]\s*(\d+)$/);
      if (range) {
        const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
        for (let w = a; w <= b; w++) {
          if (w < 1 || w > 30) continue;
          if (odd && w % 2 === 0) continue;
          if (even && w % 2 === 1) continue;
          seen[w] = true;
        }
        continue;
      }
      const one = seg.match(/^(\d+)$/);
      if (one) {
        const w = parseInt(one[1], 10);
        if (w >= 1 && w <= 30) seen[w] = true;
      }
    }
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }

  function parseSections(row) {
    const raw = String(row.jcs || row.jc || row.jcor || '');
    const nums = raw.match(/\d+/g);
    if (!nums || !nums.length) return null;
    let start = parseInt(nums[0], 10);
    let end = nums.length > 1 ? parseInt(nums[1], 10) : start;
    if (isNaN(start) || isNaN(end)) return null;
    if (end < start) { const t = start; start = end; end = t; }
    if (start < 1 || end > 20) return null;
    return { start: start, end: end };
  }

  function mergeAdjacent(list) {
    const groups = {};
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const key = [c.name, c.teacher, c.position, c.day].join('|');
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }
    const out = [];
    Object.keys(groups).forEach(function (k) {
      const arr = groups[k].slice().sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = null;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (cur && cur.weeks.join(',') === c.weeks.join(',') && cur.endSection + 1 === c.startSection) {
          cur.endSection = c.endSection;
        } else {
          if (cur) out.push(cur);
          cur = { name: c.name, position: c.position, teacher: c.teacher, day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice() };
        }
      }
      if (cur) out.push(cur);
    });
    return out;
  }

  function normalizeCourses(kbList) {
    const map = {};
    const rows = Array.isArray(kbList) ? kbList : [];
    let skipped = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const name = String(row.kcmc || '').trim();
      const day = parseInt(row.xqj, 10);
      const sec = parseSections(row);
      const weeks = parseWeeks(row.zcd);
      if (!name || !(day >= 1 && day <= 7) || !sec || !weeks.length) { skipped++; continue; }
      const teacher = String(row.xm || '').trim();
      const position = String(row.cdmc || '').trim();
      const key = [name, teacher, position, day, sec.start, sec.end].join('|');
      if (!map[key]) {
        map[key] = { name: name, position: position, teacher: teacher, day: day, startSection: sec.start, endSection: sec.end, weekSet: {} };
      }
      for (let w = 0; w < weeks.length; w++) map[key].weekSet[weeks[w]] = true;
    }
    let list = Object.keys(map).map(function (k) {
      const v = map[k];
      return {
        name: v.name, position: v.position, teacher: v.teacher, day: v.day,
        startSection: v.startSection, endSection: v.endSection,
        weeks: Object.keys(v.weekSet).map(Number).sort(function (a, b) { return a - b; })
      };
    });
    list = mergeAdjacent(list);
    return { list: list, skipped: skipped, total: rows.length };
  }

  async function runImportFlow() {
    const opts = await loadOptions();

    let xnmIdx = -1, xqmIdx = -1;
    for (let i = 0; i < opts.xnm.length; i++) if (opts.xnm[i].selected) { xnmIdx = i; break; }
    if (xnmIdx < 0) xnmIdx = 0;
    for (let i = 0; i < opts.xqm.length; i++) if (opts.xqm[i].selected) { xqmIdx = i; break; }
    if (xqmIdx < 0) xqmIdx = 0;

    // 静默探测：默认学期没课时，找到真正有课的学期作为默认项
    let cached = null;
    if (opts.xqm.length > 1) {
      try {
        const order = [xqmIdx];
        for (let i = 0; i < opts.xqm.length; i++) if (i !== xqmIdx) order.push(i);
        for (let k = 0; k < order.length; k++) {
          const idx = order[k];
          let data = null;
          try { data = await fetchKb(opts.xnm[xnmIdx].value, opts.xqm[idx].value); } catch (e) { data = null; }
          const rec = { xnm: opts.xnm[xnmIdx].value, xqm: opts.xqm[idx].value, data: data };
          const has = data && Array.isArray(data.kbList) && data.kbList.length > 0;
          if (has) { cached = rec; xqmIdx = idx; break; }
          if (!cached) cached = rec;
        }
      } catch (e) { /* 探测失败不影响后续手动选择 */ }
    }

    const i1 = await choose('选择学年', opts.xnm.map(function (o) { return o.text; }), xnmIdx);
    if (i1 < 0) { toast('已取消，未导入'); return; }

    const i2 = await choose('选择学期', opts.xqm.map(function (o) { return o.text; }), xqmIdx);
    if (i2 < 0) { toast('已取消，未导入'); return; }

    const xnm = opts.xnm[i1].value;
    const xqm = opts.xqm[i2].value;

    let kbData = null;
    if (cached && cached.xnm === xnm && cached.xqm === xqm && cached.data) kbData = cached.data;
    else kbData = await fetchKb(xnm, xqm);

    if (!kbData || !Array.isArray(kbData.kbList) || !kbData.kbList.length) {
      throw new Error('该学年学期未查询到课程，请在教务页面确认课表是否已排定');
    }

    const xqhId = (kbData.kbList[0] && kbData.kbList[0].xqh_id) ||
      (kbData.sjkList && kbData.sjkList[0] && kbData.sjkList[0].xqh_id) || '';

    const normalized = normalizeCourses(kbData.kbList);
    if (!normalized.list.length) throw new Error('解析到的课程为 0 门，请确认该学期课表是否为空');

    let slots = null;
    try { slots = await fetchTimeSlots(xnm, xqm, xqhId); } catch (e) { slots = null; }

    let tip = '学年：' + opts.xnm[i1].text + '\n学期：' + opts.xqm[i2].text +
      '\n课程：' + normalized.list.length + ' 条';
    if (normalized.skipped) tip += '\n跳过：' + normalized.skipped + ' 条';
    tip += '\n作息：' + (slots ? slots.length + ' 节' : '未取到');
    const ok = await alert('确认导入', tip + '\n\n导入会覆盖当前课表。', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(normalized.list));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let slotsFailed = false;
    if (slots) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(slots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + normalized.list.length + ' 条课程' +
      (normalized.skipped ? '，跳过 ' + normalized.skipped + ' 条异常' : '') +
      (slotsFailed ? '（作息未保存）' : ''));
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
