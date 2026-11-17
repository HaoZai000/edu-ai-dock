// 广东东软学院（NUIT）教务课表适配器
// 仅校园网可访问。使用方法：登录教务系统后直接运行，不需要手动进入课表页；
// 脚本会自己请求学期、校区、整学期课表与作息。

(async () => {
  const base = location.origin + '/jwapp/sys/homeapp/api/home';
  const bp = (typeof shiguangBridgePromise !== 'undefined' && shiguangBridgePromise) ||
    (typeof window !== 'undefined' ? window.shiguangBridgePromise : null);
  const bridge = (typeof window !== 'undefined' && window.shiguangBridge) ||
    (typeof shiguangBridge !== 'undefined' ? shiguangBridge : null);

  // 异步方法优先走 Promise 桥，同步方法（showToast / notifyTaskCompletion）回退到同步桥
  async function bridgeCall(name, args) {
    if (bp && typeof bp[name] === 'function') {
      try { return await bp[name].apply(bp, args); }
      catch (e) { return null; }
    }
    if (bridge && typeof bridge[name] === 'function') {
      try { return await bridge[name].apply(bridge, args); }
      catch (e) { return null; }
    }
    return null;
  }

  async function get(path) {
    const r = await fetch(base + path, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('请求失败: ' + path + ' (' + r.status + ')');
    return r.json();
  }

  async function post(path, obj) {
    const body = Object.keys(obj).map((k) =>
      encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])
    ).join('&');
    const r = await fetch(base + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (!r.ok) throw new Error('请求失败: ' + path + ' (' + r.status + ')');
    return r.json();
  }

  // 把教务的节次 code 映射成学生课表连续节次（去掉中午占位 5、6）
  function mapSection(code) {
    code = Number(code);
    if (!isFinite(code)) return null;
    if (code >= 1 && code <= 4) return code;
    if (code >= 7 && code <= 14) return code - 2;
    return null;
  }

  function expandWeekBit(str) {
    const out = [];
    if (typeof str !== 'string') return out;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '1') out.push(i + 1);
    }
    return out;
  }

  function cleanPlace(p) {
    if (!p) return '';
    return String(p).split(/[;；]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join('、');
  }

  function extractTeachers(item) {
    const html = (item.titleDetail || []).join(' ');
    const set = [];
    let m;
    const re = /data-kblx="02"[^>]*>([^<]+)</g;
    while ((m = re.exec(html))) {
      const n = m[1].replace(/&nbsp;/g, ' ').trim();
      if (n && set.indexOf(n) < 0) set.push(n);
    }
    if (!set.length) {
      const wt = item.weeksAndTeachers || '';
      const re2 = /\/([^\/\[]+)\[/g;
      while ((m = re2.exec(wt))) {
        const n = m[1].trim();
        if (n && set.indexOf(n) < 0) set.push(n);
      }
    }
    return set.join('、');
  }

  function toMin(t) {
    const p = String(t).split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }

  function fmt(m) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  function normalizeCourses(list) {
    const items = [];
    let skipped = 0;
    for (const it of list || []) {
      const name = (it.courseName || '').trim();
      const day = Number(it.dayOfWeek);
      const s = mapSection(it.beginSection);
      const e = mapSection(it.endSection);
      const weeks = expandWeekBit(it.week);
      if (!name || !(day >= 1 && day <= 7) || s == null || e == null || s > e || !weeks.length) {
        skipped++;
        continue;
      }
      items.push({
        name: name,
        position: cleanPlace(it.placeName),
        teacher: extractTeachers(it),
        day: day,
        startSection: s,
        endSection: e,
        weeks: weeks.slice().sort((a, b) => a - b)
      });
    }
    const keyOf = (c) => [c.name, c.teacher, c.position, c.day].join('|');
    const weekKey = (w) => w.slice().sort((a, b) => a - b).join(',');
    // 阶段一：同课同周次且节次连续 -> 合并节次
    let changed = true;
    while (changed) {
      changed = false;
      outer:
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          if (keyOf(a) === keyOf(b) && weekKey(a.weeks) === weekKey(b.weeks)) {
            if (a.endSection + 1 === b.startSection) {
              a.endSection = b.endSection;
              items.splice(j, 1);
              changed = true;
              break outer;
            }
            if (b.endSection + 1 === a.startSection) {
              b.endSection = a.endSection;
              items.splice(i, 1);
              changed = true;
              break outer;
            }
          }
        }
      }
    }
    // 阶段二：同课同节次 -> 周次取并集
    const merged = [];
    for (const c of items) {
      const ck = keyOf(c) + '|' + c.startSection + '-' + c.endSection;
      const found = merged.find((m) =>
        keyOf(m) + '|' + m.startSection + '-' + m.endSection === ck
      );
      if (found) {
        found.weeks = Array.from(new Set(found.weeks.concat(c.weeks)))
          .sort((x, y) => x - y);
      } else {
        merged.push({
          name: c.name,
          position: c.position,
          teacher: c.teacher,
          day: c.day,
          startSection: c.startSection,
          endSection: c.endSection,
          weeks: c.weeks.slice()
        });
      }
    }
    return { courses: merged, skipped };
  }

  // 从课程自带的大节起止时间推导各小节作息
  function deriveTimeSlots(arranged) {
    const map = {};
    for (const it of arranged || []) {
      const bs = mapSection(it.beginSection);
      const be = mapSection(it.endSection);
      if (bs == null || be == null || be !== bs + 1) continue;
      if (!it.beginTime || !it.endTime) continue;
      const sm = toMin(it.beginTime);
      const em = toMin(it.endTime);
      if (!(em > sm)) continue;
      const dur = Math.round((em - sm - 5) / 2);
      if (dur < 20) continue;
      map[bs] = { number: bs, startTime: fmt(sm), endTime: fmt(sm + dur) };
      map[be] = { number: be, startTime: fmt(sm + dur + 5), endTime: fmt(em) };
    }
    return Object.keys(map).sort((a, b) => a - b).map((k) => map[k]);
  }

  async function fetchAcademicOptions() {
    const j = await get('/kb/xnxq.do');
    const list = j.datas || [];
    const names = list.map((x) => x.itemName);
    let def = list.findIndex((x) => x.selected === true);
    if (def < 0) def = 0;
    return { list, names, def };
  }

  async function chooseSemester() {
    const o = await fetchAcademicOptions();
    if (!o.list.length) throw new Error('未获取到学期列表');
    const idx = await bridgeCall('showSingleSelection', ['选择学期', JSON.stringify(o.names), o.def]);
    if (idx === null || idx === undefined || idx === -1 || idx === '') return null;
    const i = Number(idx);
    if (!isFinite(i) || !o.list[i]) return null;
    return { termCode: o.list[i].itemCode, name: o.names[i] };
  }

  async function runImportFlow() {
    try {
      const ok = await bridgeCall('showAlert', ['课表导入', '将读取教务系统整学期课表并导入，请确认。', '开始导入']);
      if (ok === false) {
        await bridgeCall('showToast', ['已取消导入']);
        return;
      }

      const term = await chooseSemester();
      if (!term) {
        await bridgeCall('showToast', ['已取消导入']);
        return;
      }

      const campusRes = await get('/student/getMyScheduledCampus.do?termCode=' +
        encodeURIComponent(term.termCode));
      const campus = (campusRes.datas && campusRes.datas[0] && campusRes.datas[0].id) || '';
      if (!campus) throw new Error('未获取到校区代码');

      const params = { termCode: term.termCode, campusCode: campus };
      const [schedRes, weeksRes] = await Promise.all([
        post('/student/getMyScheduleDetail.do', Object.assign({}, params, { type: 'term' })),
        get('/getTermWeeks.do?termCode=' + encodeURIComponent(term.termCode))
      ]);

      const datas = schedRes.datas || {};
      const arranged = datas.arrangedList || [];
      const norm = normalizeCourses(arranged);
      if (!norm.courses.length) throw new Error('未解析到任何课程');

      const saved = await bridgeCall('saveImportedCourses', [JSON.stringify(norm.courses)]);
      if (saved === null || saved === false) throw new Error('课程保存失败');

      const wk = weeksRes.datas || [];
      const cfg = {};
      if (wk.length && wk[0].startDate) cfg.semesterStartDate = String(wk[0].startDate).slice(0, 10);
      if (wk.length) cfg.semesterTotalWeeks = wk.length;
      cfg.firstDayOfWeek = 1;
      if (Object.keys(cfg).length) {
        await bridgeCall('saveCourseConfig', [JSON.stringify(cfg)]);
      }

      const slots = deriveTimeSlots(arranged);
      let slotCount = 0;
      if (slots.length) {
        const slotsSaved = await bridgeCall('savePresetTimeSlots', [JSON.stringify(slots)]);
        if (slotsSaved !== null && slotsSaved !== false) slotCount = slots.length;
      }

      const slotNote = slotCount ? ('，作息 ' + slotCount + ' 节') : '';
      const skipNote = norm.skipped ? ('，跳过 ' + norm.skipped + ' 条无排课项') : '';
      await bridgeCall('showToast', [
        '已导入 ' + norm.courses.length + ' 门课（' + term.name + '）' + slotNote + skipNote
      ]);
      await bridgeCall('notifyTaskCompletion', []);
    } catch (err) {
      await bridgeCall('showToast', [
        '导入失败：' + (err && err.message ? err.message : String(err))
      ]);
    }
  }

  runImportFlow();
})();
