(async function () {
  const BASE = location.origin;
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

  function getToken() {
    const keys = ['Token', 'token', 'access_token', 'Access-Token'];
    const stores = [sessionStorage, localStorage];
    for (let i = 0; i < stores.length; i++) {
      for (let j = 0; j < keys.length; j++) {
        const v = stores[i].getItem(keys[j]);
        if (v) return v;
      }
    }
    for (let i = 0; i < stores.length; i++) {
      for (let j = 0; j < stores[i].length; j++) {
        const k = stores[i].key(j);
        if (k && /token/i.test(k)) {
          const v = stores[i].getItem(k);
          if (v && v.length > 10) return v;
        }
      }
    }
    return '';
  }

  async function api(path, params) {
    const token = getToken();
    if (!token) throw new Error('登录已失效，请重新登录教务系统');
    const url = new URL(path, BASE);
    if (params) Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { token: token, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      credentials: 'same-origin'
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error('接口返回不是 JSON，登录可能已失效'); }
    const msg = String((json && (json.Msg || json.msg || json.message)) || '');
    if (String(json && json.code) === '401' || msg.indexOf('未授权') >= 0) {
      throw new Error('登录已失效，请重新登录教务系统');
    }
    return json;
  }

  async function fetchAcademicOptions() {
    const raw = await api('/njwhd/getXnxqList');
    const arr = Array.isArray(raw) ? raw : ((raw && raw.data) || []);
    return arr.map(function (x) {
      return {
        text: x.xqmc || x.xnxq01id,
        value: x.xnxq01id,
        current: String(x.isdqxq) === '1'
      };
    });
  }

  async function chooseSemester(options) {
    if (!options.length) throw new Error('没有可用的学年学期');
    let def = options.findIndex(function (o) { return o.current; });
    if (def < 0) def = 0;
    if (options.length === 1) return options[0];
    const idx = await pick('选择学年学期', options.map(function (o) { return o.text; }), def);
    if (idx === null || idx === undefined || idx < 0) return null;
    return options[Number(idx)] || null;
  }

  function parseWeeks(detail, range) {
    const set = new Set();
    function pushText(t) {
      const s = String(t || '').replace(/周/g, '');
      if (!s) return;
      const odd = /单/.test(s), even = /双/.test(s);
      s.split(/[,，、;；]/).forEach(function (part) {
        const nums = part.match(/\d+/g);
        if (!nums || !nums.length) return;
        let a = parseInt(nums[0], 10);
        let b = nums.length > 1 ? parseInt(nums[1], 10) : a;
        if (isNaN(a) || isNaN(b)) return;
        if (b < a) { const t2 = a; a = b; b = t2; }
        for (let w = a; w <= b; w++) {
          if (odd && !even && w % 2 === 0) continue;
          if (even && !odd && w % 2 === 1) continue;
          if (w >= 1 && w <= 30) set.add(w);
        }
      });
    }
    pushText(detail);
    if (!set.size) pushText(range);
    return Array.from(set).sort(function (a, b) { return a - b; });
  }

  function addMinutes(hhmm, delta) {
    const p = String(hhmm || '').split(':');
    if (p.length < 2) return hhmm;
    const h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (isNaN(h) || isNaN(m)) return hhmm;
    let t = h * 60 + m + delta;
    t = ((t % 1440) + 1440) % 1440;
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }

  function normalizeCourses(items) {
    const valid = [];
    let bad = 0;
    items.forEach(function (it) {
      const raw = String(it.classTime || '');
      const day = parseInt(raw.charAt(0), 10);
      const secStr = raw.slice(1);
      const secs = [];
      for (let i = 0; i + 2 <= secStr.length; i += 2) {
        const s = parseInt(secStr.substr(i, 2), 10);
        if (s >= 1 && s <= 12) secs.push(s);
      }
      const weeks = parseWeeks(it.classWeekDetails, it.classWeek);
      const name = (it.courseName || '').trim();
      if (!name || !(day >= 1 && day <= 7) || secs.length === 0 || weeks.length === 0) { bad++; return; }
      const slot = secs.join('-');
      // 同一教学安排 id 下，不同星期/节次是不同的一次课，不能互相覆盖
      const id = [it.jx0408id || [name, day, slot].join('|'), day, slot].join('|');
      valid.push({
        name: name,
        position: (it.location || '').trim(),
        teacher: (it.teacherName || '').trim(),
        day: day,
        startSection: Math.min.apply(null, secs),
        endSection: Math.max.apply(null, secs),
        weeks: weeks,
        _id: id
      });
    });

    const byId = new Map();
    valid.forEach(function (c) {
      if (!byId.has(c._id)) { byId.set(c._id, Object.assign({}, c)); return; }
      const e = byId.get(c._id);
      e.weeks = Array.from(new Set(e.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
    });
    let merged = Array.from(byId.values());

    const weekKey = function (c) { return c.weeks.join(','); };
    const baseKey = function (c) { return [c.name, c.teacher, c.position, c.day].join('|'); };
    let changed = true;
    while (changed) {
      changed = false;
      const groups = new Map();
      merged.forEach(function (c) {
        const k = baseKey(c) + '||' + weekKey(c);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
      });
      const next = [];
      groups.forEach(function (g) {
        g.sort(function (a, b) { return a.startSection - b.startSection; });
        g.forEach(function (c) {
          const last = next[next.length - 1];
          if (last && baseKey(last) === baseKey(c) && weekKey(last) === weekKey(c) && c.startSection === last.endSection + 1) {
            last.endSection = c.endSection;
            changed = true;
          } else {
            next.push(Object.assign({}, c));
          }
        });
      });
      merged = next;
    }

    const bySlot = new Map();
    merged.forEach(function (c) {
      const k = baseKey(c) + '||' + c.startSection + '-' + c.endSection;
      if (!bySlot.has(k)) { bySlot.set(k, Object.assign({}, c)); return; }
      const e = bySlot.get(k);
      e.weeks = Array.from(new Set(e.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
    });
    merged = Array.from(bySlot.values());

    return {
      courses: merged.map(function (c) {
        return {
          name: c.name, position: c.position, teacher: c.teacher, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: c.weeks
        };
      }),
      bad: bad
    };
  }

  function buildTimeSlots(responses, jcdatalist) {
    const jcMap = {};
    (jcdatalist || []).forEach(function (x) {
      const ns = (String(x.XJMC || '').match(/\d+/g) || []).map(Number).filter(function (n) { return n >= 1; });
      if (!x.DJMC || !ns.length) return;
      jcMap[String(x.DJMC)] = ns;
      const dm = String(x.DJMC).match(/\d+/);
      if (dm) jcMap[dm[0]] = ns;
    });

    const tally = {};
    responses.forEach(function (r) {
      ((r.json && r.json.data) || []).forEach(function (block) {
        ((block && block.item) || []).forEach(function (it) {
          const da = String(it.maxClassTime || '');
          if (!da || da.indexOf(',') >= 0 || !it.startTime || !it.endTIme) return;
          if (!tally[da]) tally[da] = {};
          const sig = it.startTime + '-' + it.endTIme;
          tally[da][sig] = (tally[da][sig] || 0) + 1;
        });
      });
    });

    const byNum = {};
    Object.keys(jcMap).forEach(function (da) {
      const secs = jcMap[da];
      const t = tally[da];
      if (!t) return;
      const sig = Object.keys(t).sort(function (a, b) { return t[b] - t[a]; })[0];
      if (!sig) return;
      const parts = sig.split('-');
      const s = parts[0], e = parts[1];
      const sp = s.split(':').map(Number), ep = e.split(':').map(Number);
      const total = (ep[0] * 60 + ep[1]) - (sp[0] * 60 + sp[1]);
      if (!(total > 0)) return;
      if (secs.length === 1) {
        byNum[secs[0]] = { number: secs[0], startTime: s, endTime: e };
        return;
      }
      // 大节常见是 2 小节 × 45 分钟；100 分钟的大节中间有 10 分钟课间，90 分钟的没有
      if (secs.length === 2 && total >= 90) {
        const firstEnd = addMinutes(s, 45);
        const secondStart = total > 90 ? addMinutes(firstEnd, total - 90) : firstEnd;
        byNum[secs[0]] = { number: secs[0], startTime: s, endTime: firstEnd };
        byNum[secs[1]] = { number: secs[1], startTime: secondStart, endTime: e };
        return;
      }
      const step = total / secs.length;
      secs.forEach(function (sec, i) {
        byNum[sec] = {
          number: sec,
          startTime: i === 0 ? s : addMinutes(s, Math.round(step * i)),
          endTime: i === secs.length - 1 ? e : addMinutes(s, Math.round(step * (i + 1)))
        };
      });
    });
    return Object.keys(byNum).map(function (n) { return byNum[n]; })
      .sort(function (a, b) { return a.number - b.number; });
  }

  async function chooseCampus(raw) {
    const seen = {};
    const list = [];
    ((raw && raw.data) || []).forEach(function (x) {
      const id = x.kbjcmsid;
      if (!id || seen[id]) return;
      seen[id] = true;
      const name = String(x.kbjcmc || x.kbjcmsmc || x.kbjcsmc || x.name || x.kbjcmsid);
      list.push({ id: id, name: name });
    });
    if (!list.length) throw new Error('没有可用的校区课表');
    if (list.length === 1) return list[0];
    const idx = await pick('选择校区', list.map(function (x) { return x.name; }), 0);
    if (idx === null || idx === undefined || idx < 0) return null;
    return list[Number(idx)] || null;
  }

  async function runImportFlow() {
    const go = await alertBox('课表导入', '将读取所选学期的整学期课表并导入，是否继续？', '开始导入');
    if (go === false) { await toast('已取消，未导入'); return; }

    const options = await fetchAcademicOptions();
    const sem = await chooseSemester(options);
    if (!sem) { await toast('已取消，未导入'); return; }

    const campusesRaw = await api('/njwhd/Get_sjkbms');
    const campus = await chooseCampus(campusesRaw);
    if (!campus) { await toast('已取消，未导入'); return; }

    let totalWeeks = 20;
    let weeksKnown = false;
    try {
      const tw = await api('/njwhd/teachingWeek', { semester: sem.value });
      const n = ((tw && tw.data) || []).length;
      if (n > 0) { totalWeeks = n; weeksKnown = true; }
    } catch (_) { }

    const tasks = [];
    for (let w = 1; w <= totalWeeks; w++) {
      tasks.push(api('/njwhd/student/curriculum', { xnxq01id: sem.value, kbjcmsid: campus.id, week: String(w) })
        .then(function (json) { return { week: w, campus: campus.id, json: json }; })
        .catch(function () { return null; }));
    }
    const settled = await Promise.all(tasks);
    const responses = settled.filter(Boolean).filter(function (r) { return r.json && Array.isArray(r.json.data); });
    if (!responses.length) throw new Error('没有取到任何课表数据');

    const allItems = [];
    const jcdatalist = [];
    responses.forEach(function (r) {
      r.json.data.forEach(function (block) {
        ((block && block.item) || []).forEach(function (it) { allItems.push(it); });
      });
      if (r.json.jcdatalist) {
        r.json.jcdatalist.forEach(function (x) { jcdatalist.push(x); });
      }
    });

    const result = normalizeCourses(allItems);
    if (!result.courses.length) throw new Error('整学期没有解析出有效课程');

    let startDate = '';
    const w1 = responses.find(function (r) {
      return r.week === 1 && r.json.data[0] && r.json.data[0].date && r.json.data[0].date[0];
    });
    if (w1) startDate = w1.json.data[0].date[0].mxrq || '';

    const timeSlots = buildTimeSlots(responses, jcdatalist);

    const saved = await save('saveImportedCourses', JSON.stringify(result.courses));
    if (saved === false || saved === null || saved === undefined) throw new Error('课程保存失败');

    const cfg = { firstDayOfWeek: 1 };
    if (weeksKnown) cfg.semesterTotalWeeks = totalWeeks;
    if (startDate) cfg.semesterStartDate = startDate;
    try {
      const cfgSaved = await save('saveCourseConfig', JSON.stringify(cfg));
      if (cfgSaved === false || cfgSaved === null || cfgSaved === undefined) await toast('学期配置保存失败，课程已导入');
    } catch (_) {
      await toast('学期配置保存失败，课程已导入');
    }

    if (timeSlots.length) {
      try {
        const slotsSaved = await save('savePresetTimeSlots', JSON.stringify(timeSlots));
        if (slotsSaved === false || slotsSaved === null || slotsSaved === undefined) await toast('作息保存失败，课程已导入');
      } catch (_) {
        await toast('作息保存失败，课程已导入');
      }
    }

    await toast('已导入 ' + result.courses.length + ' 门课程' + (result.bad ? '，跳过 ' + result.bad + ' 条无效数据' : ''));
    if (BR && typeof BR.notifyTaskCompletion === 'function') BR.notifyTaskCompletion();
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = (e && e.message) || String(e);
    try { await alertBox('导入失败', msg, '知道了'); } catch (_) { }
    await toast('导入失败：' + msg);
  }
})();
