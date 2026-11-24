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

  const BASE = location.origin + '/jwglxt';
  const GN = 'N2151';
  const INDEX_URL = BASE + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=' + GN + '&layout=default';
  const KB_URL = BASE + '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=' + GN;
  const JC_URL = BASE + '/kbcx/xskbcx_cxRjc.html?gnmkdm=' + GN;

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body
    });
  }

  function parseWeeks(zcd) {
    if (!zcd) return [];
    const out = new Set();
    const s = String(zcd).replace(/（/g, '(').replace(/）/g, ')');
    const re = /(\d+)\s*(?:-\s*(\d+))?\s*周\s*(?:\((单|双)\))?/g;
    let m;
    while ((m = re.exec(s))) {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      const p = m[3];
      if (isNaN(a) || isNaN(b)) continue;
      for (let w = Math.max(1, Math.min(a, b)); w <= Math.max(a, b) && w <= 30; w++) {
        if (p === '单' && w % 2 === 0) continue;
        if (p === '双' && w % 2 === 1) continue;
        out.add(w);
      }
    }
    return Array.from(out).sort(function (x, y) { return x - y; });
  }

  function parseSections(jcs) {
    const t = String(jcs || '');
    const m = t.match(/(\d+)\s*-\s*(\d+)/);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    const one = t.match(/(\d+)/);
    return one ? [parseInt(one[1], 10), parseInt(one[1], 10)] : [0, 0];
  }

  function normalizeCourses(list) {
    const ok = [];
    let bad = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i] || {};
      const day = parseInt(r.xqj, 10);
      const se = parseSections(r.jcs || r.jc);
      const s = se[0];
      const e = se[1];
      const weeks = parseWeeks(r.zcd);
      const name = (r.kcmc || '').trim();
      if (!name || !(day >= 1 && day <= 7) || !(s >= 1) || !(e >= s) || !weeks.length) { bad++; continue; }
      ok.push({
        name: name,
        teacher: (r.xm || '').trim(),
        position: (r.cdmc || '').trim(),
        day: day,
        startSection: s,
        endSection: e,
        weeks: weeks
      });
    }

    const map = new Map();
    ok.forEach(function (c) {
      const k = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      const hit = map.get(k);
      if (hit) hit.weeks = Array.from(new Set(hit.weeks.concat(c.weeks))).sort(function (x, y) { return x - y; });
      else map.set(k, c);
    });

    const arr = Array.from(map.values());
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < arr.length && !merged; i++) {
        for (let j = 0; j < arr.length && !merged; j++) {
          if (i === j) continue;
          const a = arr[i];
          const b = arr[j];
          if (a.name === b.name && a.teacher === b.teacher && a.position === b.position &&
              a.day === b.day && a.endSection + 1 === b.startSection &&
              a.weeks.length === b.weeks.length &&
              a.weeks.every(function (w, k) { return w === b.weeks[k]; })) {
            a.endSection = b.endSection;
            arr.splice(j, 1);
            merged = true;
          }
        }
      }
    }
    return { courses: arr, bad: bad };
  }

  async function fetchAcademicOptions() {
    const res = await fetch(INDEX_URL, { credentials: 'include' });
    if (!res.ok) throw new Error('课表查询页读取失败（HTTP ' + res.status + '），请在教务系统页面运行');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const read = function (sel) {
      const el = doc.querySelector(sel);
      if (!el) return [];
      return Array.prototype.slice.call(el.options)
        .map(function (o) {
          return { value: (o.value || '').trim(), text: (o.textContent || '').trim(), sel: o.selected };
        })
        .filter(function (o) { return o.value !== '' && o.text !== ''; });
    };
    const years = read('#xnm');
    const terms = read('#xqm');
    if (!years.length || !terms.length) throw new Error('课表页未找到 #xnm / #xqm 下拉框');
    const def = function (list) {
      for (let i = 0; i < list.length; i++) if (list[i].sel) return i;
      return 0;
    };
    return { years: years, terms: terms, yearDef: def(years), termDef: def(terms) };
  }

  async function fetchTimetable(sem) {
    const res = await post(KB_URL,
      'xnm=' + encodeURIComponent(sem.xnm) + '&xqm=' + encodeURIComponent(sem.xqm) +
      '&kzlx=ck&xsdm=&kclbdm=&kclxdm=');
    if (!res.ok) throw new Error('课表请求失败（HTTP ' + res.status + '）');
    const json = await res.json();
    if (!json || !Array.isArray(json.kbList)) throw new Error('课表接口未返回 kbList');
    return json;
  }

  async function fetchTimeSlots(sem, xqhId) {
    const res = await post(JC_URL,
      'xnm=' + encodeURIComponent(sem.xnm) + '&xqm=' + encodeURIComponent(sem.xqm) +
      '&xqh_id=' + encodeURIComponent(xqhId || '1'));
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list
      .map(function (r) {
        return { number: parseInt(r.jcmc, 10), startTime: r.qssj, endTime: r.jssj };
      })
      .filter(function (s) {
        return s.number >= 1 &&
          /^\d{2}:\d{2}$/.test(String(s.startTime || '')) &&
          /^\d{2}:\d{2}$/.test(String(s.endTime || ''));
      })
      .sort(function (a, b) { return a.number - b.number; });
  }

  async function runImportFlow() {
    const opt = await fetchAcademicOptions();
    const yi = await select('选择学年', opt.years.map(function (o) { return o.text; }), opt.yearDef);
    if (yi === null) { toast('已取消，未导入'); return; }
    const ti = await select('选择学期', opt.terms.map(function (o) { return o.text; }), opt.termDef);
    if (ti === null) { toast('已取消，未导入'); return; }

    const y = opt.years[yi];
    const t = opt.terms[ti];
    if (!y || !t) throw new Error('学年/学期选择无效');
    const sem = { xnm: y.value, xqm: t.value, label: y.text + ' ' + t.text };

    toast('正在读取课表…');
    const kb = await fetchTimetable(sem);
    if (kb.xsxx && kb.xsxx.XNM && kb.xsxx.XNM !== sem.xnm) {
      throw new Error('学期切换未生效：返回 ' + kb.xsxx.XNMC + '，目标 ' + y.text);
    }
    const kbList = kb.kbList;
    if (!kbList.length) throw new Error('该学期未查到课程（' + sem.label + '）');

    const xqhId = (kb.xsxx && kb.xsxx.xqh_id) || (kbList[0] && kbList[0].xqh_id) || '';
    const slots = xqhId ? await fetchTimeSlots(sem, xqhId).catch(function () { return []; }) : [];

    const unscheduled = (kb.sjkList || []).length;
    const result = normalizeCourses(kbList);
    const courses = result.courses;
    if (!courses.length) throw new Error('未解析到任何课程，导入中止');

    let tip = '学期：' + sem.label + '，课程 ' + courses.length + ' 条';
    if (result.bad) tip += '，跳过 ' + result.bad + ' 条信息不全';
    if (unscheduled) tip += '，另有 ' + unscheduled + ' 条未排课未导入';
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
      (result.bad ? '，跳过 ' + result.bad + ' 条异常' : '') +
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
