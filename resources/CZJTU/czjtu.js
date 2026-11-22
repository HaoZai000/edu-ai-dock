(async function main() {
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

  async function choose(title, labels, def) {
    if (labels.length === 1) return 0;
    const f = ui('showSingleSelection');
    if (!f) throw new Error('当前环境不支持选择');
    const r = await f(title, JSON.stringify(labels), def);
    if (r === null || r === undefined || r === -1) return -1;
    const n = Number(r);
    return Number.isInteger(n) && n >= 0 && n < labels.length ? n : -1;
  }

  const origin = location.origin;
  const PAGE = '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
  const URL_KB = '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const URL_RJC = '/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

  function postForm(path, data) {
    const body = new URLSearchParams(data).toString();
    return fetch(origin + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body
    }).then(function (r) {
      if (!r.ok) throw new Error('请求失败(' + r.status + ')，请确认已登录');
      return r.json();
    });
  }

  function readSelect(doc, id) {
    const sel = doc.querySelector('#' + id);
    if (!sel) return null;
    const opts = Array.from(sel.querySelectorAll('option')).filter(function (o) { return String(o.value) !== ''; });
    if (!opts.length) return null;
    let idx = opts.findIndex(function (o) { return o.hasAttribute('selected'); });
    if (idx < 0) idx = 0;
    return {
      values: opts.map(function (o) { return o.value; }),
      labels: opts.map(function (o) { return String(o.textContent || '').trim(); }),
      idx: idx
    };
  }

  function readAcademic(doc) {
    const xnm = readSelect(doc, 'xnm');
    const xqm = readSelect(doc, 'xqm');
    return xnm && xqm ? { xnm: xnm, xqm: xqm } : null;
  }

  async function fetchAcademicOptions() {
    const res = await fetch(origin + PAGE, { credentials: 'include' });
    if (!res.ok) throw new Error('课表页请求失败(' + res.status + ')，请先登录');
    const html = await res.text();
    let found = readAcademic(new DOMParser().parseFromString(html, 'text/html'));
    if (!found) {
      try { found = readAcademic(document); } catch (e) {}
    }
    if (!found) throw new Error('未找到学年/学期下拉框，请先打开课表查询页');
    return found;
  }

  async function chooseSemester(opts) {
    const y = await choose('选择学年', opts.xnm.labels, opts.xnm.idx);
    if (y < 0) return null;
    const t = await choose('选择学期', opts.xqm.labels, opts.xqm.idx);
    if (t < 0) return null;
    return {
      xnm: opts.xnm.values[y], xqm: opts.xqm.values[t],
      xnmc: opts.xnm.labels[y], xqmc: opts.xqm.labels[t]
    };
  }

  function parseWeeks(raw) {
    if (!raw) return [];
    const text = String(raw).replace(/[（）()]/g, '').trim();
    const weeks = new Set();
    text.split(/[,，、;；]/).forEach(function (p) {
      const seg = p.replace(/周/g, '').trim();
      if (!seg) return;
      const odd = seg.indexOf('单') > -1;
      const even = seg.indexOf('双') > -1;
      const m = seg.match(/(\d+)\s*[-~至到]\s*(\d+)/) || seg.match(/(\d+)/);
      if (!m) return;
      let a = parseInt(m[1], 10);
      let b = m[2] ? parseInt(m[2], 10) : a;
      if (!isFinite(a) || !isFinite(b)) return;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      for (let w = Math.max(1, a); w <= b && w <= 30; w++) {
        if (odd && w % 2 === 0) continue;
        if (even && w % 2 !== 0) continue;
        weeks.add(w);
      }
    });
    return Array.from(weeks).sort(function (x, y) { return x - y; });
  }

  function normalizeCourses(list) {
    const raw = [];
    let skipped = 0;
    (list || []).forEach(function (it) {
      const name = String(it.kcmc || '').trim();
      const day = parseInt(it.xqj, 10);
      const jcText = String(it.jcor || it.jcs || it.jc || '');
      const mm = jcText.match(/(\d+)\s*[-~至到]\s*(\d+)/) || jcText.match(/(\d+)/);
      let start = mm ? parseInt(mm[1], 10) : NaN;
      let end = mm && mm[2] ? parseInt(mm[2], 10) : start;
      const weeks = parseWeeks(it.zcd);
      if (end < start) { const tmp = start; start = end; end = tmp; }
      if (!name || !(day >= 1 && day <= 7) || !(start >= 1) || !(end >= start) || end > 30 || !weeks.length) {
        skipped++;
        return;
      }
      raw.push({
        name: name,
        position: String(it.cdmc || '').trim(),
        teacher: String(it.xm || '').trim(),
        day: day,
        startSection: start,
        endSection: end,
        weeks: weeks
      });
    });

    const groups = new Map();
    raw.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    });

    const merged = [];
    groups.forEach(function (group) {
      const bySection = new Map();
      group.forEach(function (c) {
        const k = c.startSection + '-' + c.endSection;
        if (!bySection.has(k)) {
          bySection.set(k, {
            name: c.name, position: c.position, teacher: c.teacher, day: c.day,
            startSection: c.startSection, endSection: c.endSection,
            weeks: new Set(c.weeks)
          });
        } else {
          const t = bySection.get(k);
          c.weeks.forEach(function (w) { t.weeks.add(w); });
        }
      });
      const arr = Array.from(bySection.values()).map(function (c) {
        return {
          name: c.name, position: c.position, teacher: c.teacher, day: c.day,
          startSection: c.startSection, endSection: c.endSection,
          weeks: Array.from(c.weeks).sort(function (a, b) { return a - b; })
        };
      });
      arr.sort(function (a, b) { return a.startSection - b.startSection || a.endSection - b.endSection; });
      const out = [];
      arr.forEach(function (c) {
        const last = out[out.length - 1];
        if (last && c.startSection <= last.endSection + 1 && last.weeks.join(',') === c.weeks.join(',')) {
          last.endSection = Math.max(last.endSection, c.endSection);
        } else {
          out.push({
            name: c.name, position: c.position, teacher: c.teacher, day: c.day,
            startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
          });
        }
      });
      out.forEach(function (c) { merged.push(c); });
    });

    merged.sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
    return { courses: merged, skipped: skipped };
  }

  function pickCampus(list) {
    const count = new Map();
    list.forEach(function (c) {
      const id = String(c.xqh_id || '').trim();
      if (id) count.set(id, (count.get(id) || 0) + 1);
    });
    let best = '';
    let max = 0;
    count.forEach(function (n, id) {
      if (n > max) { max = n; best = id; }
    });
    return best || '1';
  }

  async function fetchTimeSlots(sem, xqhId) {
    const arr = await postForm(URL_RJC, { xnm: sem.xnm, xqm: sem.xqm, xqh_id: xqhId || '1' });
    if (!Array.isArray(arr)) return [];
    const map = new Map();
    arr.forEach(function (it) {
      const m = String(it.jcmc == null ? '' : it.jcmc).match(/\d+/);
      const n = m ? parseInt(m[0], 10) : NaN;
      const st = String(it.qssj || '').trim();
      const et = String(it.jssj || '').trim();
      if (!(n >= 1 && n <= 30) || !/^\d{1,2}:\d{2}$/.test(st) || !/^\d{1,2}:\d{2}$/.test(et)) return;
      if (!map.has(n)) map.set(n, { number: n, startTime: st, endTime: et });
    });
    return Array.from(map.values()).sort(function (a, b) { return a.number - b.number; });
  }

  async function runImportFlow() {
    const go = await alert('课表导入', '将读取所选学期整学期课表并导入，是否继续？', '继续');
    if (!go) {
      toast('已取消，未导入');
      return;
    }

    const opts = await fetchAcademicOptions();
    const sem = await chooseSemester(opts);
    if (!sem) {
      toast('已取消，未导入');
      return;
    }

    toast('正在读取课表数据…');
    const data = await postForm(URL_KB, { xnm: sem.xnm, xqm: sem.xqm, kzlx: 'ck', xsdm: '' });
    const kbList = data && Array.isArray(data.kbList) ? data.kbList : [];
    const sjkList = data && Array.isArray(data.sjkList) ? data.sjkList : [];
    if (!kbList.length) throw new Error('该学期课表为空，或登录已失效');

    const result = normalizeCourses(kbList);
    if (!result.courses.length) throw new Error('课表解析后没有有效课程');

    const xqhId = pickCampus(kbList);
    let slots = [];
    try { slots = await fetchTimeSlots(sem, xqhId); } catch (e) { slots = []; }

    let summary = '学期：' + sem.xnmc + ' ' + sem.xqmc +
      '\n课程：' + result.courses.length + ' 门' +
      (result.skipped ? '\n跳过不完整：' + result.skipped + ' 条' : '') +
      (sjkList.length ? '\n实践课：' + sjkList.length + ' 门无固定节次，不导入' : '') +
      '\n作息：' + (slots.length ? slots.length + ' 节' : '未取到') +
      '\n\n导入会覆盖当前课表。';
    const confirmed = await alert('确认导入', summary, '导入');
    if (!confirmed) {
      toast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(result.courses));
    if (saved === false || saved === 'false') throw new Error('课程保存失败');

    let slotsFailed = false;
    if (slots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(slots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') BD.notifyTaskCompletion();
    const notes = [];
    if (result.skipped) notes.push('跳过 ' + result.skipped + ' 条不完整记录');
    if (sjkList.length) notes.push(sjkList.length + ' 门实践课无固定节次未导入');
    if (slotsFailed) notes.push('作息未保存');
    toast('已导入 ' + result.courses.length + ' 门课程' + (notes.length ? '，' + notes.join('，') : ''));
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
