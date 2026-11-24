(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BD = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  function toast(msg) {
    if (BD && typeof BD.showToast === 'function') {
      try { BD.showToast(msg); return; } catch (e) { return; }
    }
    try {
      const r = BP && typeof BP.showToast === 'function' ? BP.showToast(msg) : null;
      if (r && typeof r.catch === 'function') r.catch(function () {});
    } catch (e) {}
  }

  async function alert(title, content, confirmText) {
    if (!BP || typeof BP.showAlert !== 'function') return true;
    return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
  }

  // 只有一个选项时直接使用，不再弹选择框
  async function select(title, labels, def) {
    if (!labels.length) throw new Error('未找到可选项：' + title);
    if (labels.length === 1) return 0;
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    const picked = await BP.showSingleSelection(title, JSON.stringify(labels), def);
    if (picked === null || picked === undefined) return null;
    const n = Number(picked);
    if (!isFinite(n) || n < 0) return null;
    return n < labels.length ? n : def;
  }

  async function saveCourses(courses) {
    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const ok = await BP.saveImportedCourses(JSON.stringify(courses));
    if (ok === false || ok === 'false' || ok === null) throw new Error('课程保存失败');
  }

  function finish() {
    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    }
  }

  const BASE = location.origin;
  const INDEX_PATH = '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
  const KB_PATH = '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151&sf_request_type=ajax';
  const JC_PATH = '/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151&sf_request_type=ajax';

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body
    });
    if (!res.ok) throw new Error('接口请求失败（HTTP ' + res.status + '）');
    const text = await res.text();
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (e) {
      throw new Error('课表接口返回异常，请重新登录教务系统');
    }
  }

  function parseWeeks(raw) {
    const out = new Set();
    if (!raw) return [];
    String(raw).split(/[,，;；]/).forEach(function (part) {
      let seg = part.trim();
      if (!seg) return;
      const onlyOdd = seg.indexOf('单') >= 0;
      const onlyEven = seg.indexOf('双') >= 0;
      seg = seg.replace(/第/g, '').replace(/[周（）()单双\s]/g, '');
      if (!seg) return;
      const push = function (w) {
        if (w < 1 || w > 30) return;
        if (onlyOdd && w % 2 === 0) return;
        if (onlyEven && w % 2 === 1) return;
        out.add(w);
      };
      const range = seg.match(/^(\d+)\s*[-~—]\s*(\d+)$/);
      if (range) {
        const a = parseInt(range[1], 10);
        const b = parseInt(range[2], 10);
        for (let w = Math.min(a, b); w <= Math.max(a, b); w++) push(w);
      } else if (/^\d+$/.test(seg)) {
        push(parseInt(seg, 10));
      }
    });
    return Array.from(out).sort(function (a, b) { return a - b; });
  }

  function normalizeCourses(list) {
    const base = [];
    let skipped = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i] || {};
      const name = (c.kcmc || '').trim();
      const teacher = (c.xm || '').trim();
      const position = (c.cdmc || c.cdbh || '').trim();
      const day = parseInt(c.xqj, 10);
      const m = String(c.jcs || c.jcor || c.jc || '').match(/(\d+)\s*-\s*(\d+)/);
      const weeks = parseWeeks(c.zcd || '');
      if (!name || !(day >= 1 && day <= 7) || !m || !weeks.length) { skipped++; continue; }
      base.push({
        name: name,
        teacher: teacher,
        position: position,
        day: day,
        startSection: parseInt(m[1], 10),
        endSection: parseInt(m[2], 10),
        weeks: weeks
      });
    }

    // 同课同周次下把相邻节次并成一段
    const byW = new Map();
    const s1 = [];
    base.forEach(function (c) {
      const k = [c.name, c.teacher, c.position, c.day].join('\u0001') + '\u0002' + c.weeks.join(',');
      const a = byW.get(k) || [];
      let done = false;
      for (let i = 0; i < a.length; i++) {
        const x = a[i];
        if (x.endSection + 1 === c.startSection) { x.endSection = c.endSection; done = true; break; }
        if (c.endSection + 1 === x.startSection) { x.startSection = c.startSection; done = true; break; }
      }
      if (!done) {
        const cp = Object.assign({}, c, { weeks: c.weeks.slice() });
        a.push(cp);
        s1.push(cp);
      }
      byW.set(k, a);
    });

    // 同课同节次合并周次
    const byS = new Map();
    s1.forEach(function (c) {
      const k = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('\u0001');
      const p = byS.get(k);
      if (p) {
        p.weeks = Array.from(new Set(p.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      } else {
        byS.set(k, Object.assign({}, c, { weeks: c.weeks.slice() }));
      }
    });

    return { courses: Array.from(byS.values()), skipped: skipped };
  }

  function collect(doc) {
    let y = [];
    let t = [];
    const selects = doc.querySelectorAll('select');
    for (let i = 0; i < selects.length; i++) {
      const s = selects[i];
      const os = Array.prototype.slice.call(s.options)
        .map(function (o) {
          return { v: (o.value || '').trim(), t: (o.textContent || '').trim(), s: !!o.selected };
        })
        .filter(function (o) { return o.v && o.v !== '00'; });
      if (!os.length) continue;
      const idn = ((s.id || '') + ' ' + (s.name || '')).toLowerCase();
      const tx = os.map(function (o) { return o.t; }).join(' ');
      if (/xnm|xnd/.test(idn) || /20\d\d\s*-\s*20\d\d/.test(tx)) {
        if (os.length > y.length) y = os;
      } else if (/xqm|xqd/.test(idn) || /^[\d\s]+$/.test(tx)) {
        if (os.length > t.length && os.length <= 6) t = os;
      }
    }
    return { y: y, t: t };
  }

  async function runImportFlow() {
    toast('正在读取课表…');
    const res = await fetch(BASE + INDEX_PATH, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('课表查询页读取失败（HTTP ' + res.status + '），请重新登录教务系统');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const got = collect(doc);
    if (!got.y.length || !got.t.length) throw new Error('未找到学年/学期下拉框，请确认已登录教务系统');

    // 学年 × 学期组合，默认选中当前页面已有的学期
    const combos = [];
    const labels = [];
    got.y.forEach(function (a) {
      got.t.forEach(function (b) {
        combos.push({ xnm: a.v, xqm: b.v });
        labels.push(a.t + ' ' + b.t);
      });
    });
    let def = 0;
    let yi = -1;
    let ti = -1;
    for (let i = 0; i < got.y.length; i++) if (got.y[i].s) { yi = i; break; }
    for (let i = 0; i < got.t.length; i++) if (got.t[i].s) { ti = i; break; }
    if (yi >= 0 && ti >= 0) def = yi * got.t.length + ti;

    const pick = await select('选择学年学期', labels, def);
    if (pick === null) { toast('已取消，未导入'); return; }
    const sem = combos[pick];
    if (!sem) throw new Error('学年学期选择无效');
    const semLabel = labels[pick];

    const kb = await post(BASE + KB_PATH,
      'xnm=' + encodeURIComponent(sem.xnm) + '&xqm=' + encodeURIComponent(sem.xqm) +
      '&kzlx=ck&xsdm=&kclbdm=&kclxdm=');
    const list = kb && kb.kbList;
    if (!Array.isArray(list) || !list.length) throw new Error('未读到课程列表');

    const xqh = (list.find(function (c) { return c && c.xqh_id; }) || {}).xqh_id || '';
    let slots = [];
    if (xqh) {
      try {
        const rj = await post(BASE + JC_PATH,
          'xnm=' + encodeURIComponent(sem.xnm) + '&xqm=' + encodeURIComponent(sem.xqm) +
          '&xqh_id=' + encodeURIComponent(xqh));
        if (Array.isArray(rj)) {
          slots = rj.filter(function (r) { return r && r.jcmc && r.qssj && r.jssj; })
            .map(function (r) {
              return {
                number: parseInt(r.jcmc, 10),
                startTime: String(r.qssj).slice(0, 5),
                endTime: String(r.jssj).slice(0, 5)
              };
            })
            .filter(function (s) {
              return s.number >= 1 &&
                /^\d{1,2}:\d{2}$/.test(s.startTime) &&
                /^\d{1,2}:\d{2}$/.test(s.endTime);
            })
            .sort(function (a, b) { return a.number - b.number; });
        }
      } catch (e) {}
    }

    const result = normalizeCourses(list);
    const courses = result.courses;
    if (!courses.length) throw new Error('没有有效课程');

    let tip = '学期：' + semLabel + '，课程 ' + courses.length + ' 条';
    if (result.skipped) tip += '，跳过 ' + result.skipped + ' 条信息不全';
    if (slots.length) tip += '，作息 ' + slots.length + ' 节';
    const ok = await alert('确认导入', tip + '。是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    await saveCourses(courses);

    let slotsFailed = false;
    if (slots.length) {
      try {
        if (BP && typeof BP.savePresetTimeSlots === 'function') {
          await BP.savePresetTimeSlots(JSON.stringify(slots));
        }
      } catch (e) {
        slotsFailed = true;
      }
    }

    toast('已导入 ' + courses.length + ' 条课程' +
      (result.skipped ? '，跳过 ' + result.skipped + ' 条异常' : '') +
      (slotsFailed ? '（作息未保存）' : ''));
    finish();
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
