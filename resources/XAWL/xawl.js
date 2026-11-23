// 西安文理学院（jwgl.xawl.edu.cn，正方 jwglxt）整学期课表适配器
(async function main() {
  const BASE = location.origin + '/jwglxt';

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

  async function select(title, labels, def) {
    const f = ui('showSingleSelection');
    if (!f) throw new Error('桥未就绪，请重试');
    return await f(title, JSON.stringify(labels), def);
  }

  function extractSelectOptions(html, name) {
    const out = { list: [], selected: 0 };
    const selRe = new RegExp('<select[^>]*\\bname=["\']?' + name + '["\']?[^>]*>([\\s\\S]*?)<\\/select>', 'i');
    const sm = html.match(selRe);
    if (!sm) return out;
    const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let om;
    while ((om = optRe.exec(sm[1])) !== null) {
      const vm = om[1].match(/value=["']([^"']*)["']/i);
      const val = vm ? vm[1].trim() : '';
      if (!val) continue;
      const txt = om[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (/selected/i.test(om[1])) out.selected = out.list.length;
      out.list.push({ value: val, text: txt });
    }
    return out;
  }

  async function fetchAcademicOptions() {
    const resp = await fetch(BASE + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151', { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('课表查询页请求失败：HTTP ' + resp.status);
    const html = await resp.text();
    const y = extractSelectOptions(html, 'xnm');
    const t = extractSelectOptions(html, 'xqm');
    if (!y.list.length || !t.list.length) throw new Error('未能解析学年/学期下拉框，请确认已登录教务系统');
    const options = [];
    y.list.forEach((Y) => t.list.forEach((T) => options.push({
      label: Y.text + ' 第' + T.text + '学期', xnm: Y.value, xqm: T.value
    })));
    return { options, defaultIndex: y.selected * t.list.length + t.selected };
  }

  async function chooseSemester(data) {
    // 只有一个学年学期时直接使用，避免多余的选择交互
    if (data.options.length === 1) return data.options[0];
    const idx = await select('选择学年学期', data.options.map((o) => o.label), data.defaultIndex);
    if (idx === null || idx === undefined || Number(idx) < 0 || !data.options[Number(idx)]) return null;
    return data.options[Number(idx)];
  }

  async function fetchKb(xnm, xqm) {
    const body = new URLSearchParams({ xnm: xnm, xqm: xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' });
    const resp = await fetch(BASE + '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!resp.ok) throw new Error('课表接口请求失败：HTTP ' + resp.status);
    const j = await resp.json();
    return j.kbList || [];
  }

  async function fetchTimeSlots(xnm, xqm, xqhId) {
    const body = new URLSearchParams({ xnm: xnm, xqm: xqm, xqh_id: xqhId || '1' });
    const resp = await fetch(BASE + '/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!resp.ok) throw new Error('作息接口请求失败：HTTP ' + resp.status);
    const arr = await resp.json();
    const list = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.list) ? arr.list : []);
    return list.map((x) => ({ number: parseInt(x.jcmc, 10), startTime: x.qssj, endTime: x.jssj }))
      .filter((s) => s.number >= 1 && s.startTime && s.endTime)
      .sort((a, b) => a.number - b.number);
  }

  function parseWeeks(str) {
    const set = new Set();
    String(str || '').split(/[,，]/).forEach((part) => {
      const p = part.trim();
      if (!p) return;
      const odd = /单/.test(p), even = /双/.test(p);
      const range = p.match(/(\d+)\s*[-~至]\s*(\d+)/);
      const push = (w) => {
        if (w < 1 || w > 30) return;
        if (odd && w % 2 === 0) return;
        if (even && w % 2 === 1) return;
        set.add(w);
      };
      if (range) {
        for (let w = parseInt(range[1], 10); w <= parseInt(range[2], 10) && w <= 30; w++) push(w);
      } else {
        const s = p.match(/(\d+)/);
        if (s) push(parseInt(s[1], 10));
      }
    });
    return Array.from(set).sort((a, b) => a - b);
  }

  function parseSection(str) {
    const m = String(str || '').match(/(\d+)\s*[-~至]\s*(\d+)/);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    const s = String(str || '').match(/(\d+)/);
    return s ? [parseInt(s[1], 10), parseInt(s[1], 10)] : null;
  }

  function normalizeCourses(list) {
    const raw = [];
    let skipped = 0;
    for (const c of list) {
      const day = parseInt(c.xqj, 10);
      const sec = parseSection(c.jcor || c.jcs || c.jc);
      const weeks = parseWeeks(c.zcd);
      const name = String(c.kcmc || '').trim();
      if (!name || !(day >= 1 && day <= 7) || !sec || sec[0] < 1 || sec[1] < sec[0] || !weeks.length) {
        skipped++;
        continue;
      }
      raw.push({
        name: name,
        position: String(c.cdmc || '').trim(),
        teacher: String(c.xm || '').trim(),
        day: day,
        startSection: sec[0],
        endSection: sec[1],
        weeks: weeks
      });
    }
    const g1 = new Map();
    raw.forEach((c) => {
      const key = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      if (!g1.has(key)) g1.set(key, []);
      g1.get(key).push(c);
    });
    const stage1 = [];
    for (const arr of g1.values()) {
      arr.sort((a, b) => a.startSection - b.startSection);
      let cur = Object.assign({}, arr[0], { weeks: arr[0].weeks.slice() });
      for (let i = 1; i < arr.length; i++) {
        const n = arr[i];
        if (n.startSection <= cur.endSection + 1) cur.endSection = Math.max(cur.endSection, n.endSection);
        else { stage1.push(cur); cur = Object.assign({}, n, { weeks: n.weeks.slice() }); }
      }
      stage1.push(cur);
    }
    const g2 = new Map();
    stage1.forEach((c) => {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!g2.has(key)) g2.set(key, Object.assign({}, c, { weeks: [] }));
      const ws = g2.get(key).weeks;
      c.weeks.forEach((w) => { if (ws.indexOf(w) < 0) ws.push(w); });
    });
    const result = Array.from(g2.values()).map((c) =>
      Object.assign({}, c, { weeks: c.weeks.sort((a, b) => a - b) }));
    return { courses: result, skipped: skipped };
  }

  async function runImportFlow() {
    const meta = await fetchAcademicOptions();
    const chosen = await chooseSemester(meta);
    if (!chosen) { toast('已取消，未导入'); return; }

    let kbList = [], slots = [];
    const [kbRes, slotRes] = await Promise.allSettled([
      fetchKb(chosen.xnm, chosen.xqm),
      fetchTimeSlots(chosen.xnm, chosen.xqm, '1')
    ]);
    if (kbRes.status === 'fulfilled') kbList = kbRes.value || [];
    if (slotRes.status === 'fulfilled') slots = slotRes.value || [];
    if (!kbList.length) throw new Error('未获取到课表数据，请确认所选学期已排课');

    const normalized = normalizeCourses(kbList);
    if (!normalized.courses.length) throw new Error('课表数据中没有可导入的有效课程');

    let tip = '学期：' + chosen.label + '\n课程：' + normalized.courses.length + ' 条';
    if (normalized.skipped) tip += '（跳过 ' + normalized.skipped + ' 条异常）';
    if (slots.length) tip += '\n作息：' + slots.length + ' 节';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(normalized.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let slotsFailed = false;
    if (slots.length) {
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
    toast('已导入 ' + normalized.courses.length + ' 门课程' +
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
