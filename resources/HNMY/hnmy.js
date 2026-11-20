(async function main() {
  const BASE = location.origin;
  const KB_PAGE = '/admin/xsd/pkgl/xskb/queryKbForXsd';
  const SYKB_API = '/admin/xsd/pkgl/xskb/sdpkkbList';
  const SCHEDULE_API = '/admin/api/getZclistByXnxq';

  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BR = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  async function uiAlert(title, content, confirmText) {
    if (BP && typeof BP.showAlert === 'function') {
      return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
    }
    if (BR && typeof BR.showAlert === 'function') {
      return (await BR.showAlert(title, content, confirmText || '确定')) !== false;
    }
    return true;
  }

  async function uiSelect(title, labels, defaultIndex) {
    if (BP && typeof BP.showSingleSelection === 'function') {
      const r = await BP.showSingleSelection(title, JSON.stringify(labels), defaultIndex);
      if (r === null || r === undefined) return -1;
      const n = Number(r);
      return Number.isInteger(n) && n >= 0 && n < labels.length ? n : -1;
    }
    return labels.length === 1 ? 0 : -1;
  }

  function uiToast(msg) {
    try {
      if (BR && typeof BR.showToast === 'function') { BR.showToast(msg); return; }
      if (BP && typeof BP.showToast === 'function') { BP.showToast(msg); }
    } catch (e) {}
  }

  function stripHtml(s) {
    const d = new DOMParser().parseFromString(String(s == null ? '' : s), 'text/html');
    return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  async function getKbPageHtml(xnxq) {
    const url = BASE + KB_PAGE + (xnxq ? '?xnxq=' + encodeURIComponent(xnxq) : '');
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('课表查询页请求失败：' + res.status);
    return await res.text();
  }

  async function fetchAcademicOptions() {
    const html = await getKbPageHtml('');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sel = doc.querySelector('select#xnxq1');
    if (!sel) throw new Error('课表页未找到学年学期下拉框，请确认已登录教务系统');
    const options = [];
    let defaultIndex = 0;
    Array.prototype.forEach.call(sel.querySelectorAll('option'), function (o) {
      if (!o.value) return;
      options.push({ label: (o.textContent || '').trim(), value: o.value });
      if (o.selected) defaultIndex = options.length - 1;
    });
    if (!options.length) throw new Error('学年学期下拉框为空');
    return { options: options, defaultIndex: defaultIndex };
  }

  async function fetchIdentity(xnxq) {
    const html = await getKbPageHtml(xnxq);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const xhid = doc.querySelector('input#xhid');
    const xqdm = doc.querySelector('input#xqdm');
    if (!xhid || !xhid.value || !xqdm || !xqdm.value) throw new Error('课表页未取得 xhid / xqdm，请重新登录后重试');
    return { xhid: xhid.value, xqdm: xqdm.value };
  }

  async function fetchCourses(xnxq, xhid, xqdm) {
    const q = new URLSearchParams({ xnxq: xnxq, xhid: xhid, xqdm: xqdm, zdzc: '', zxzc: '', xskbxslx: '0' });
    const res = await fetch(BASE + SYKB_API + '?' + q.toString(), { credentials: 'same-origin' });
    if (!res.ok) throw new Error('整学期课表接口失败：' + res.status);
    const json = await res.json();
    if (json.ret !== 0 || !Array.isArray(json.data)) throw new Error('整学期课表返回异常：' + (json.msg || ''));
    return json.data;
  }

  async function fetchScheduleInfo(xnxq) {
    const q = new URLSearchParams({ xnxq: xnxq, role: '', userId: '', xqid: '' });
    const res = await fetch(BASE + SCHEDULE_API + '?' + q.toString(), { credentials: 'same-origin' });
    if (!res.ok) throw new Error('作息/校历接口失败：' + res.status);
    const json = await res.json();
    if (json.ret !== 0 || !json.data) throw new Error('作息/校历返回异常：' + (json.msg || ''));
    return json.data;
  }

  function expandWeeks(raw) {
    const out = new Set();
    const text = String(raw == null ? '' : raw).replace(/[周\s]/g, '').replace(/[()（）]/g, '');
    if (!text) return out;
    text.split(/[,，、]/).forEach(function (piece) {
      let p = piece.trim().replace(/^第/, '');
      if (!p) return;
      let parity = 0;
      if (p.indexOf('单') >= 0) { parity = 1; p = p.replace(/单/g, ''); }
      else if (p.indexOf('双') >= 0) { parity = 2; p = p.replace(/双/g, ''); }
      const m = p.match(/^(\d+)[-~至](\d+)$/);
      let a, b;
      if (m) { a = parseInt(m[1], 10); b = parseInt(m[2], 10); }
      else if (/^\d+$/.test(p)) { a = b = parseInt(p, 10); }
      else return;
      if (!(a >= 1 && b >= a) || a > 30) return;
      b = Math.min(b, 30);
      for (let w = a; w <= b; w++) {
        if (parity === 1 && w % 2 === 0) continue;
        if (parity === 2 && w % 2 === 1) continue;
        out.add(w);
      }
    });
    return out;
  }

  function normalizeCourses(list) {
    const byBlock = new Map();
    let bad = 0;
    list.forEach(function (o) {
      const name = stripHtml(o.kcmc);
      const teacher = stripHtml(o.tmc);
      const position = stripHtml(o.croommc);
      const day = parseInt(o.xingqi, 10);
      const section = parseInt(o.djc, 10);
      const weeks = expandWeeks(o.zcstr || o.zc);
      if (!name || name === '-' || !(day >= 1 && day <= 7) || !(section >= 1 && section <= 30) || weeks.size === 0) {
        bad++;
        return;
      }
      const weekKey = Array.from(weeks).sort(function (a, b) { return a - b; }).join(',');
      const key = [name, teacher, position, day, weekKey].join('|');
      if (!byBlock.has(key)) {
        byBlock.set(key, { name: name, teacher: teacher, position: position, day: day, weeks: weeks, sections: [] });
      }
      byBlock.get(key).sections.push(section);
    });

    const bySlot = new Map();
    byBlock.forEach(function (b) {
      const secs = Array.from(new Set(b.sections)).sort(function (a, c) { return a - c; });
      let start = secs[0];
      let end = secs[0];
      const flush = function () {
        const key = [b.name, b.teacher, b.position, b.day, start, end].join('|');
        if (!bySlot.has(key)) {
          bySlot.set(key, {
            name: b.name, teacher: b.teacher, position: b.position, day: b.day,
            startSection: start, endSection: end, weeks: new Set()
          });
        }
        b.weeks.forEach(function (w) { bySlot.get(key).weeks.add(w); });
      };
      for (let i = 1; i < secs.length; i++) {
        if (secs[i] === end + 1) {
          end = secs[i];
        } else {
          flush();
          start = secs[i];
          end = secs[i];
        }
      }
      flush();
    });

    const courses = Array.from(bySlot.values()).map(function (c) {
      return {
        name: c.name, position: c.position, teacher: c.teacher, day: c.day,
        startSection: c.startSection, endSection: c.endSection,
        weeks: Array.from(c.weeks).sort(function (a, b) { return a - b; })
      };
    }).sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
    return { courses: courses, bad: bad };
  }

  function normalizeSlots(list) {
    const byNumber = new Map();
    (list || []).forEach(function (s) {
      const nm = String(s.jc == null ? '' : s.jc).match(/\d+/);
      if (!nm) return;
      const n = parseInt(nm[0], 10);
      const fmt = function (t) {
        const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
        return m ? (m[1].padStart(2, '0') + ':' + m[2]) : null;
      };
      const st = fmt(s.kssj);
      const et = fmt(s.jssj);
      if (n >= 1 && n <= 30 && st && et && !byNumber.has(n)) {
        byNumber.set(n, { number: n, startTime: st, endTime: et });
      }
    });
    return Array.from(byNumber.values()).sort(function (a, b) { return a.number - b.number; });
  }

  function normalizeConfig(schedule) {
    const zclist = Array.isArray(schedule.zclist) ? schedule.zclist : [];
    if (!zclist.length) return null;
    const cfg = {};
    for (let i = 0; i < zclist.length; i++) {
      const m = String(zclist[i].minrq || '').match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) { cfg.semesterStartDate = m[1]; break; }
    }
    if (zclist.length >= 1 && zclist.length <= 60) cfg.semesterTotalWeeks = zclist.length;
    return Object.keys(cfg).length ? cfg : null;
  }

  try {
    const academic = await fetchAcademicOptions();
    let idx = academic.defaultIndex;
    if (academic.options.length > 1) {
      idx = await uiSelect('选择学年学期', academic.options.map(function (o) { return o.label; }), idx);
      if (idx < 0 || idx >= academic.options.length) {
        uiToast('已取消，未导入');
        return;
      }
    }
    const semester = academic.options[idx];

    const identity = await fetchIdentity(semester.value);
    const results = await Promise.all([
      fetchCourses(semester.value, identity.xhid, identity.xqdm).catch(function (e) { return { error: e }; }),
      fetchScheduleInfo(semester.value).catch(function (e) { return { error: e }; })
    ]);
    if (results[0].error) throw results[0].error;

    const normalized = normalizeCourses(results[0]);
    if (!normalized.courses.length) throw new Error('整学期课表解析后没有课程');

    const schedule = results[1] && !results[1].error ? results[1] : null;
    const slots = schedule ? normalizeSlots(schedule.jcsjszList) : [];
    const config = schedule ? normalizeConfig(schedule) : null;

    const confirmed = await uiAlert(
      '确认导入',
      '学期：' + semester.label + '\n课程：' + normalized.courses.length + ' 门' +
        (normalized.bad > 0 ? '（跳过异常 ' + normalized.bad + ' 条）' : '') +
        '\n\n导入会覆盖当前课表。',
      '导入'
    );
    if (!confirmed) {
      uiToast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(normalized.courses));
    if (saved === false || saved === 'false') throw new Error('课程保存失败');

    let configFailed = false;
    let slotsFailed = false;
    if (config) {
      try {
        await BP.saveCourseConfig(JSON.stringify(config));
      } catch (e) {
        configFailed = true;
      }
    }
    if (slots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(slots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BR && typeof BR.notifyTaskCompletion === 'function') BR.notifyTaskCompletion();

    const warn = configFailed || slotsFailed ? '（' + (configFailed ? '校历未保存 ' : '') + (slotsFailed ? '作息未保存' : '') + '）' : '';
    uiToast('导入完成：' + normalized.courses.length + ' 门课' + (normalized.bad > 0 ? '，跳过异常 ' + normalized.bad + ' 条' : '') + warn);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await uiAlert('导入失败', msg, '知道了');
    uiToast('导入失败：' + msg);
  }
})();
