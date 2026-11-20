// 新疆农业职业技术大学（XJAVTU）教务课表适配脚本
// 遵循 edu-ai-dock 规范：使用 shiguangBridgePromise / shiguangBridge 回写课程、配置与作息。
(async () => {
  'use strict';

  const bp = (typeof window !== 'undefined' && window.shiguangBridgePromise) || {};
  const bridge = (typeof window !== 'undefined' && window.shiguangBridge) || {};

  function toast(msg) {
    try {
      if (typeof bridge.showToast === 'function') bridge.showToast(String(msg));
    } catch (_) {}
  }

  async function showAlert(title, content, confirmText) {
    if (typeof bp.showAlert === 'function') {
      return await bp.showAlert(title, content, confirmText || '确定');
    }
    return true;
  }

  async function showSingleSelection(title, items, defaultIndex) {
    if (typeof bp.showSingleSelection !== 'function') {
      throw new Error('当前环境不支持列表选择器');
    }
    const idx = await bp.showSingleSelection(title, JSON.stringify(items), defaultIndex || 0);
    if (idx === null || idx === undefined || idx === -1) return null;
    const n = Number(idx);
    return Number.isInteger(n) && n >= 0 && n < items.length ? n : null;
  }

  // 自动识别教务系统上下文路径（兼容 /jwglxt 前缀、根目录部署及 WebVPN 路径）
  function resolveBasePrefix() {
    const pathname = location.pathname || '';
    const jwMatch = pathname.match(/^(.*\/jwglxt)(?:\/|$)/i);
    if (jwMatch) return location.origin + jwMatch[1];
    const modMatch = pathname.match(/^(.*)\/(?:kbcx|xtgl|xsxxxggl|jzgl)\//i);
    if (modMatch) return location.origin + modMatch[1];
    return location.origin + '/jwglxt';
  }

  const BASE = resolveBasePrefix();

  // 信息查询 -> 学生课表查询（按周次）对应正方教务 N2154 模块，同时兼容 N2151
  const INDEX_URLS = [
    BASE + '/kbcx/xskbcxZccx_cxXskbcxIndex.html?gnmkdm=N2154&layout=default',
    BASE + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default'
  ];

  const KB_URLS = [
    BASE + '/kbcx/xskbcxMobile_cxXsKb.html?gnmkdm=N2154',
    BASE + '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2154',
    BASE + '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151'
  ];

  const CALENDAR_URL = BASE + '/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154';

  const TIME_SLOT_URLS = [
    BASE + '/jzgl/skxxMobile_cxRsdjc.html?gnmkdm=N2154',
    BASE + '/kbcx/xskbcx_cxRjc.html?gnmkdm=N2154',
    BASE + '/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151'
  ];

  function formBody(params) {
    return Object.keys(params)
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k]))
      .join('&');
  }

  async function postJson(url, params) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: formBody(params)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    return JSON.parse(text);
  }

  function readSelectOptions(doc, selector) {
    const sel = doc.querySelector(selector);
    if (!sel) return null;
    const items = [];
    let def = 0;
    const opts = sel.querySelectorAll('option');
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      const val = (o.value || '').trim();
      if (!val) continue;
      const rawText = (o.textContent || '').trim();
      items.push({ value: val, text: rawText });
      if (o.selected || o.hasAttribute('selected')) {
        def = items.length - 1;
      }
    }
    if (!items.length) return null;
    const live = document.querySelector(selector);
    if (live && live.value) {
      const liveIdx = items.findIndex((x) => x.value === live.value.trim());
      if (liveIdx >= 0) def = liveIdx;
    }
    return { items, def };
  }

  // 读取学年与学期下拉选项（优先读取当前页面 DOM，其次请求 N2154 / N2151 课表查询页）
  async function fetchAcademicOptions() {
    const curYears = readSelectOptions(document, '#xnm');
    const curTerms = readSelectOptions(document, '#xqm');
    if (curYears && curTerms) {
      return { years: curYears, terms: curTerms };
    }

    for (let i = 0; i < INDEX_URLS.length; i++) {
      try {
        const res = await fetch(INDEX_URLS[i], { method: 'GET', credentials: 'include' });
        if (!res.ok) continue;
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const years = readSelectOptions(doc, '#xnm');
        const terms = readSelectOptions(doc, '#xqm');
        if (years && terms) return { years, terms };
      } catch (_) {}
    }
    throw new Error('未能读取学年/学期选项，请先从一站式服务大厅进入教务系统（或打开「信息查询 -> 学生课表查询（按周次）」页面）后再点击导入');
  }

  async function chooseSemester() {
    const opts = await fetchAcademicOptions();
    const yearLabels = opts.years.items.map((x) => x.text);
    const yi = await showSingleSelection('选择学年', yearLabels, opts.years.def);
    if (yi === null) return null;

    const termLabels = opts.terms.items.map((x) => (/学期/.test(x.text) ? x.text : '第' + x.text + '学期'));
    const ti = await showSingleSelection('选择学期', termLabels, opts.terms.def);
    if (ti === null) return null;

    const y = opts.years.items[yi];
    const t = opts.terms.items[ti];
    return {
      xnm: y.value,
      xqm: t.value,
      label: y.text + ' ' + termLabels[ti]
    };
  }

  // 展开周次字符串，兼容 "1-16周"、"1-15周(单)"、"2-16周(双)"、"1-4,6-8周"、"第5周"
  function expandWeeks(zcd) {
    if (!zcd) return [];
    const weeks = [];
    const parts = String(zcd).replace(/\s+/g, '').split(/[,，、;；]/);
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (!seg) continue;
      const isOdd = /单/.test(seg);
      const isEven = /双/.test(seg);
      const range = seg.match(/(\d+)\s*[-~至]\s*(\d+)/);
      const single = seg.match(/(\d+)/);
      let start = 0;
      let end = 0;
      if (range) {
        start = parseInt(range[1], 10);
        end = parseInt(range[2], 10);
      } else if (single) {
        start = end = parseInt(single[1], 10);
      } else {
        continue;
      }
      if (end < start) {
        const tmp = start;
        start = end;
        end = tmp;
      }
      for (let w = start; w <= end && w <= 30; w++) {
        if (w < 1) continue;
        if (isOdd && !isEven && w % 2 === 0) continue;
        if (isEven && !isOdd && w % 2 === 1) continue;
        weeks.push(w);
      }
    }
    return Array.from(new Set(weeks)).sort((a, b) => a - b);
  }

  function parseSections(item) {
    const raw = String(item.jcs || item.jcor || item.jc || '');
    const nums = (raw.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= 30);
    if (!nums.length) return null;
    return {
      start: Math.min.apply(null, nums),
      end: Math.max.apply(null, nums)
    };
  }

  // 两阶段合并：阶段1合并同课同周次的连续节次，阶段2合并同课同节次的周次并集
  function normalizeCourses(kbList) {
    const valid = [];
    let skipped = 0;
    for (let i = 0; i < (kbList || []).length; i++) {
      const it = kbList[i];
      const name = String(it.kcmc || '').trim();
      const day = parseInt(it.xqj, 10);
      const sec = parseSections(it);
      const weeks = expandWeeks(it.zcd);
      if (!name || !(day >= 1 && day <= 7) || !sec || sec.start > sec.end || !weeks.length) {
        skipped++;
        continue;
      }
      let pos = String(it.cdmc || '').trim();
      if (pos === '未排地点' || pos === '无楼号' || pos === '无') pos = '';
      valid.push({
        name,
        teacher: String(it.xm || '').trim(),
        position: pos,
        day,
        startSection: sec.start,
        endSection: sec.end,
        weeks
      });
    }

    const baseKey = (c) => [c.name, c.teacher, c.position, c.day].join('\u0001');
    const weekKey = (c) => c.weeks.join(',');

    const byWeek = {};
    for (let i = 0; i < valid.length; i++) {
      const c = valid[i];
      const k = baseKey(c) + '|' + weekKey(c);
      (byWeek[k] = byWeek[k] || []).push(c);
    }

    const stage1 = [];
    Object.keys(byWeek).forEach((k) => {
      const group = byWeek[k].slice().sort((a, b) => a.startSection - b.startSection);
      let cur = null;
      for (let i = 0; i < group.length; i++) {
        const c = group[i];
        if (cur && c.startSection <= cur.endSection + 1) {
          cur.endSection = Math.max(cur.endSection, c.endSection);
        } else {
          if (cur) stage1.push(cur);
          cur = {
            name: c.name,
            teacher: c.teacher,
            position: c.position,
            day: c.day,
            startSection: c.startSection,
            endSection: c.endSection,
            weeks: c.weeks.slice()
          };
        }
      }
      if (cur) stage1.push(cur);
    });

    const bySec = {};
    const order = [];
    for (let i = 0; i < stage1.length; i++) {
      const c = stage1[i];
      const k = baseKey(c) + '|' + c.startSection + '-' + c.endSection;
      if (bySec[k]) {
        bySec[k].weeks = Array.from(new Set(bySec[k].weeks.concat(c.weeks))).sort((a, b) => a - b);
      } else {
        bySec[k] = c;
        order.push(k);
      }
    }

    return {
      courses: order.map((k) => bySec[k]),
      skipped
    };
  }

  // 拉取整学期课表（依次尝试 N2154 Mobile 接口、N2154 个人课表接口、N2151 个人课表接口）
  async function fetchTimetableData(xnm, xqm) {
    let lastErr = null;
    for (let i = 0; i < KB_URLS.length; i++) {
      try {
        const data = await postJson(KB_URLS[i], {
          xnm,
          xqm,
          kzlx: 'ck',
          xsdm: '',
          kclbdm: '',
          kclxdm: ''
        });
        if (data && Array.isArray(data.kbList) && data.kbList.length > 0) {
          return data;
        }
        if (data && Array.isArray(data.kbList)) {
          lastErr = new Error('所选学期暂无课表数据');
        }
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('课表接口请求失败');
  }

  // 读取校历周次（N2154 按周次查询接口），提取开学日期与学期总周数
  async function fetchCourseConfig(xnm, xqm) {
    try {
      const list = await postJson(CALENDAR_URL, { xnm, xqm });
      if (!Array.isArray(list) || !list.length) return null;
      const firstWeek = list.find((item) => String(item.zs) === '1' || String(item.zsmc) === '1') || list[0];
      let startDate = String((firstWeek && firstWeek.rq) || '').split('/')[0].trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        const m = String((firstWeek && (firstWeek.zcrq || firstWeek.ksrq)) || '').match(/(\d{4}-\d{2}-\d{2})/);
        startDate = m ? m[1] : '';
      }
      if (!startDate) return null;
      return {
        semesterStartDate: startDate,
        semesterTotalWeeks: list.length,
        firstDayOfWeek: 1
      };
    } catch (_) {
      return null;
    }
  }

  // 读取节次作息时间表
  async function fetchTimeSlots(xnm, xqm, xqhId) {
    for (let i = 0; i < TIME_SLOT_URLS.length; i++) {
      try {
        const params = { xnm, xqm };
        if (xqhId) params.xqh_id = xqhId;
        const data = await postJson(TIME_SLOT_URLS[i], params);
        const list = Array.isArray(data) ? data : ((data && (data.items || data.jcList || data.list)) || []);
        if (!Array.isArray(list) || !list.length) continue;
        const byNum = new Map();
        for (let j = 0; j < list.length; j++) {
          const item = list[j];
          const num = parseInt(item.jcmc, 10) || (j + 1);
          const s = String(item.qssj || '').trim().slice(0, 5);
          const e = String(item.jssj || '').trim().slice(0, 5);
          if (num >= 1 && /^\d{1,2}:\d{2}$/.test(s) && /^\d{1,2}:\d{2}$/.test(e) && !byNum.has(num)) {
            byNum.set(num, { number: num, startTime: s, endTime: e });
          }
        }
        const slots = Array.from(byNum.values()).sort((a, b) => a.number - b.number);
        if (slots.length) return slots;
      } catch (_) {}
    }
    return [];
  }

  try {
    const ok = await showAlert(
      '教务课表导入',
      '将从「信息查询 -> 学生课表查询（按周次）」读取所选学期的整学期课表、校历与作息时间，是否开始？',
      '开始导入'
    );
    if (ok === false) {
      toast('已取消导入');
      return;
    }

    const sem = await chooseSemester();
    if (!sem) {
      toast('已取消导入');
      return;
    }

    toast('正在获取课表数据...');
    const data = await fetchTimetableData(sem.xnm, sem.xqm);
    const norm = normalizeCourses(data.kbList);
    if (!norm.courses.length) {
      throw new Error('未解析到有效课程，请确认所选学期是否有排课');
    }

    const firstItem = data.kbList[0] || {};
    const xqhId = firstItem.xqh_id ? String(firstItem.xqh_id) : '';

    const [config, timeSlots] = await Promise.all([
      fetchCourseConfig(sem.xnm, sem.xqm),
      fetchTimeSlots(sem.xnm, sem.xqm, xqhId)
    ]);

    const saved = await bp.saveImportedCourses(JSON.stringify(norm.courses));
    if (saved === false || saved === null) {
      throw new Error('课程保存失败');
    }

    if (config) {
      try {
        await bp.saveCourseConfig(JSON.stringify(config));
      } catch (_) {}
    }

    if (timeSlots.length) {
      try {
        await bp.savePresetTimeSlots(JSON.stringify(timeSlots));
      } catch (_) {}
    }

    toast('已导入 ' + norm.courses.length + ' 门课程（' + sem.label + '）');
    if (typeof bridge.notifyTaskCompletion === 'function') {
      bridge.notifyTaskCompletion();
    }
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    await showAlert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
