// 西安培华学院（kj.peihua.cn，正方 jwglxt 班级课表）整学期课表适配器
(async function main() {
  const BASE = location.origin + '/jwglxt';
  const INDEX_URL = BASE + '/kbdy/bjkbdy_cxBjkbdyIndex.html?gnmkdm=N214505&layout=default';
  const KB_URL = BASE + '/kbdy/bjkbdy_cxBjKb.html?gnmkdm=N214505';
  const RJC_URL = BASE + '/kbdy/bjkbdy_cxRjc.html?gnmkdm=N214505';

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

  function postForm(url, params) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: params.toString()
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (t) {
      return (typeof t === 'string') ? JSON.parse(t) : t;
    });
  }

  function optionsOf(sel) {
    if (!sel) return [];
    return Array.prototype.map.call(sel.options, function (o) {
      return { text: (o.textContent || o.text || '').trim(), value: o.value, selected: !!o.selected };
    });
  }

  function picked(arr) {
    const i = arr.findIndex(function (x) { return x.selected; });
    return i >= 0 ? arr[i] : arr[0];
  }

  // 学年学期选项 + 页面上下文
  async function fetchAcademicOptions() {
    const res = await fetch(INDEX_URL, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('打开课表查询页失败 HTTP ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const years = optionsOf(doc.querySelector('#xnm'));
    const terms = optionsOf(doc.querySelector('#xqm'));
    if (!years.length || !terms.length) throw new Error('未找到学年/学期下拉框，请确认已登录教务系统');

    const q = function (id) { return picked(optionsOf(doc.querySelector(id))); };
    const xqh = q('#xqh_id'), nj = q('#njdm_id'), jg = q('#jg_id'), zy = q('#zyh_id'), bj = q('#bh_id');
    const ctx = {
      xqh_id: xqh.value || '',
      njdm_id: nj.value || '',
      jg_id: jg.value || '',
      zyh_id: zy.value || '',
      bh_id: bj.value || '',
      zymc: (zy.text || '').replace(/\([^()]*\)\s*$/, '').trim(),
      jgmc: jg.text || '',
      njmc: nj.text || '',
      bjmc: bj.text || ''
    };

    const curYear = picked(years), curTerm = picked(terms);
    const yearIdx = years.findIndex(function (x) { return x.value === curYear.value; });
    const termIdx = terms.findIndex(function (x) { return x.value === curTerm.value; });

    const choices = [], map = [];
    years.forEach(function (y) {
      terms.forEach(function (t) {
        choices.push(y.text + ' 第' + t.text + '学期');
        map.push({ xnm: y.value, xnmc: y.text, xqm: t.value, xqmmc: t.text });
      });
    });
    const defaultIndex = Math.max(0, yearIdx * terms.length + termIdx);
    return { choices: choices, map: map, defaultIndex: defaultIndex, ctx: ctx };
  }

  async function chooseSemester(opts) {
    // 只有一个学年学期时直接使用，避免多余的选择交互
    if (opts.choices.length === 1) return opts.map[0];
    const idx = await select('选择要导入的学年学期', opts.choices, opts.defaultIndex);
    if (idx === null || idx === undefined || Number(idx) < 0 || !opts.map[Number(idx)]) return null;
    return opts.map[Number(idx)];
  }

  // 并行取数：课表 + 作息
  async function fetchAll(sem, ctx) {
    const kbParams = new URLSearchParams();
    kbParams.set('xnm', sem.xnm);
    kbParams.set('xqm', sem.xqm);
    kbParams.set('xnmc', sem.xnmc);
    kbParams.set('xqmmc', sem.xqmmc);
    kbParams.set('xqh_id', ctx.xqh_id);
    kbParams.set('njdm_id', ctx.njdm_id);
    kbParams.set('zyh_id', ctx.zyh_id);
    kbParams.set('bh_id', ctx.bh_id);
    kbParams.set('tjkbzdm', '1');
    kbParams.set('tjkbzxsdm', '0');
    // 页面没取到的字段就留空，不塞猜测值
    kbParams.set('zymc', ctx.zymc || '');
    kbParams.set('jgmc', ctx.jgmc || '');
    kbParams.set('njmc', ctx.njmc || '');
    kbParams.set('bj', ctx.bjmc || '');
    kbParams.set('xkrs', '');
    kbParams.set('jsxm', '');
    kbParams.set('lxdh', '');
    kbParams.set('bh', '');
    kbParams.set('zs', '');
    kbParams.set('zxszjjs', 'false');
    kbParams.set('xsdm', '');
    kbParams.set('kclxdm', '');
    kbParams.set('kclbdm', '');
    kbParams.set('kbsjlyqz', '');
    kbParams.set('yf', '');
    kbParams.set('kzlx', 'ck');
    kbParams.set('sfcxxqh', '1');

    const rjcParams = new URLSearchParams();
    rjcParams.set('xnm', sem.xnm);
    rjcParams.set('xqm', sem.xqm);
    rjcParams.set('xqh_id', ctx.xqh_id);

    const results = await Promise.allSettled([
      postForm(KB_URL, kbParams),
      postForm(RJC_URL, rjcParams)
    ]);
    let kbData = null, rjcData = null;
    if (results[0].status === 'fulfilled') kbData = results[0].value;
    if (results[1].status === 'fulfilled') rjcData = results[1].value;
    return { kbData: kbData, rjcData: rjcData };
  }

  function parseSections(jcor) {
    const m = String(jcor || '').match(/(\d+)\s*[-－—~至]\s*(\d+)/);
    if (m) return { startSection: +m[1], endSection: +m[2] };
    const m2 = String(jcor || '').match(/(\d+)/);
    if (m2) return { startSection: +m2[1], endSection: +m2[1] };
    return null;
  }

  function parseWeeks(zcds) {
    const weeks = [];
    String(zcds || '').split(/[,，\s]+/).forEach(function (part) {
      if (!part) return;
      const seg = part.match(/^(\d+)-(\d+)$/);
      if (seg) {
        const a = +seg[1], b = +seg[2];
        for (let i = a; i <= b && i <= 30; i++) weeks.push(i);
      } else if (/^\d+$/.test(part)) {
        weeks.push(+part);
      }
    });
    return Array.from(new Set(weeks)).filter(function (w) { return w >= 1 && w <= 30; })
      .sort(function (a, b) { return a - b; });
  }

  // 校验 + 两阶段合并
  function normalizeCourses(list) {
    const out = [];
    let skipped = 0;
    (list || []).forEach(function (it) {
      const name = (it.kcmc || '').trim();
      const day = +it.xqj;
      const sec = parseSections(it.jcor || it.jcs || it.xsdj || it.jc);
      const weeks = parseWeeks(it.zcds);
      if (!name || !(day >= 1 && day <= 7) || !sec || sec.startSection < 1 ||
          sec.endSection < sec.startSection || !weeks.length) {
        skipped++;
        return;
      }
      out.push({
        name: name,
        position: (it.cdmc || '').trim(),
        teacher: (it.xm || '').trim(),
        day: day,
        startSection: sec.startSection,
        endSection: sec.endSection,
        weeks: weeks,
        _key: name + '|' + (it.xm || '').trim() + '|' + (it.cdmc || '').trim() + '|' + day
      });
    });
    // 阶段1：同课同周次且节次连续 -> 合并连续节次
    const s1 = [];
    out.forEach(function (c) {
      const hit = s1.find(function (x) {
        return x._key === c._key && x.weeks.join(',') === c.weeks.join(',') && c.startSection === x.endSection + 1;
      });
      if (hit) hit.endSection = c.endSection;
      else s1.push(Object.assign({}, c));
    });
    // 阶段2：同课同节次 -> 周次并集
    const s2 = [];
    s1.forEach(function (c) {
      const hit = s2.find(function (x) {
        return x._key === c._key && x.startSection === c.startSection && x.endSection === c.endSection;
      });
      if (hit) hit.weeks = Array.from(new Set(hit.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      else s2.push(Object.assign({}, c));
    });
    s2.forEach(function (c) { delete c._key; });
    return { courses: s2, skipped: skipped };
  }

  function buildTimeSlots(rjcData) {
    const list = Array.isArray(rjcData) ? rjcData
      : (rjcData && Array.isArray(rjcData.list) ? rjcData.list : []);
    const slots = [];
    list.forEach(function (r) {
      const num = parseInt(String(r.jcmc == null ? '' : r.jcmc).replace(/[^\d]/g, ''), 10);
      if (num >= 1 && r.qssj && r.jssj) slots.push({ number: num, startTime: r.qssj, endTime: r.jssj });
    });
    slots.sort(function (a, b) { return a.number - b.number; });
    return slots;
  }

  function semesterConfig(weekNum) {
    const cfg = {};
    const wn = weekNum || [];
    if (wn.length) {
      const m = String(wn[0].rq || '').match(/(\d{4}-\d{2}-\d{2})/);
      if (m) cfg.semesterStartDate = m[1];
      cfg.semesterTotalWeeks = wn.length;
    }
    return cfg;
  }

  async function runImportFlow() {
    const opts = await fetchAcademicOptions();
    const sem = await chooseSemester(opts);
    if (!sem) { toast('已取消，未导入'); return; }

    const data = await fetchAll(sem, opts.ctx);
    const kbData = data.kbData;
    if (!kbData || !Array.isArray(kbData.kbList)) {
      throw new Error('未取到课表数据，请确认所选学期该班级有课表');
    }
    const normalized = normalizeCourses(kbData.kbList);
    if (!normalized.courses.length) throw new Error('课表为空或课程字段无法解析');

    const cfg = semesterConfig(kbData.weekNum);
    const slots = buildTimeSlots(data.rjcData);
    let tip = '学期：' + sem.xnmc + ' 第' + sem.xqmmc + '学期\n课程：' + normalized.courses.length + ' 条';
    if (normalized.skipped) tip += '（跳过 ' + normalized.skipped + ' 条异常）';
    if (cfg.semesterTotalWeeks) tip += '\n教学周：' + cfg.semesterTotalWeeks + ' 周';
    if (slots.length) tip += '\n作息：' + slots.length + ' 节';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(normalized.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    if (Object.keys(cfg).length) {
      try {
        await BP.saveCourseConfig(JSON.stringify(cfg));
      } catch (e) {
        configFailed = true;
      }
    }
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
      (normalized.skipped ? '，跳过 ' + normalized.skipped + ' 条异常数据' : '') +
      (configFailed ? '（校历未保存）' : '') +
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
