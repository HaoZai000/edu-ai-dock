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

  function resolveTimetableUrl() {
    const here = location.pathname.indexOf('showTimetable.do') >= 0 ? location.href : '';
    if (here && /[?&]id=/.test(here)) return here;

    const links = Array.prototype.slice.call(document.querySelectorAll('a[href*="showTimetable.do"]'));
    let pick = null;
    for (let i = 0; i < links.length; i++) {
      if (/sectionType=BASE/i.test(links[i].getAttribute('href') || '')) { pick = links[i]; break; }
    }
    if (!pick && links.length) pick = links[0];
    if (pick) {
      try { return new URL(pick.getAttribute('href'), location.origin).href; } catch (e) {}
    }

    const frames = Array.prototype.slice.call(document.querySelectorAll('iframe'));
    for (let j = 0; j < frames.length; j++) {
      const src = frames[j].getAttribute('src') || '';
      if (src.indexOf('showTimetable.do') >= 0) {
        try { return new URL(src, location.origin).href; } catch (e) {}
      }
    }
    return null;
  }

  async function fetchGbk(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('课表请求失败：HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    let text;
    try {
      text = new TextDecoder('gbk').decode(buf);
    } catch (e) {
      text = new TextDecoder('utf-8').decode(buf);
    }
    if (text.indexOf('id="timetable"') < 0 && text.indexOf("id='timetable'") < 0) {
      if (/登录|login|学年传递错误|权限/.test(text)) {
        throw new Error('课表页需要重新登录或参数失效，请重新打开课表页');
      }
      throw new Error('课表页结构异常，未找到课表表格');
    }
    return text;
  }

  function htmlToLines(html) {
    const holder = document.createElement('div');
    holder.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
    return holder.textContent
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map(function (s) { return s.replace(/\s+/g, ' ').trim(); })
      .filter(function (s) { return s !== ''; });
  }

  function splitBlocks(lines) {
    const blocks = [];
    let cur = null;
    lines.forEach(function (line) {
      if (/^<<.+?>>/.test(line)) {
        if (cur) blocks.push(cur);
        cur = [line];
      } else if (cur) {
        cur.push(line);
      }
    });
    if (cur) blocks.push(cur);
    return blocks;
  }

  function parseWeeks(text) {
    const weeks = {};
    String(text || '').split(/[,，、;；]/).forEach(function (segment) {
      const onlyOdd = /单/.test(segment);
      const onlyEven = /双/.test(segment);
      const s = segment.replace(/[周（）()]/g, '');
      const re = /(\d{1,2})\s*(?:[-—~至]\s*(\d{1,2}))?/g;
      let m;
      while ((m = re.exec(s))) {
        let a = parseInt(m[1], 10);
        let b = m[2] ? parseInt(m[2], 10) : a;
        if (isNaN(a) || isNaN(b)) continue;
        if (b < a) { const t = a; a = b; b = t; }
        for (let w = Math.max(1, a); w <= b && w <= 30; w++) {
          if (onlyOdd && w % 2 === 0) continue;
          if (onlyEven && w % 2 === 1) continue;
          weeks[w] = true;
        }
      }
    });
    return Object.keys(weeks).map(Number).sort(function (x, y) { return x - y; });
  }

  function looksLikeRoom(s) {
    return /楼|室|校区|教\d|场|馆|中心|实验室|^[A-Za-z]?\d|号/.test(String(s || ''));
  }

  function parseBlock(lines) {
    const head = lines[0] || '';
    const m = /^<<\s*([\s\S]+?)\s*>>/.exec(head);
    if (!m) return null;
    const name = m[1].trim();
    if (!name) return null;
    const rest = lines.slice(1);
    let weekIdx = -1;
    for (let i = 0; i < rest.length; i++) {
      if (/\d/.test(rest[i]) && /周|单|双/.test(rest[i])) { weekIdx = i; break; }
    }
    if (weekIdx < 0) return null;
    const weeks = parseWeeks(rest[weekIdx]);
    if (!weeks.length) return null;

    const before = rest.slice(0, weekIdx).filter(function (s) { return s && s !== '*'; });
    let teacher = '';
    let position = '';
    if (before.length === 1) {
      teacher = before[0];
    } else if (before.length >= 2) {
      const a = before[before.length - 2];
      const b = before[before.length - 1];
      if (looksLikeRoom(a) && !looksLikeRoom(b)) {
        position = a;
        teacher = b;
      } else if (looksLikeRoom(b) && !looksLikeRoom(a)) {
        teacher = a;
        position = b;
      } else {
        teacher = a;
        position = b;
      }
    }
    return { name: name, position: position, teacher: teacher, weeks: weeks };
  }

  function parseTimetable(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#timetable');
    if (!table) throw new Error('课表页结构异常，未找到课表表格');

    const titleEl = doc.querySelector('#title');
    const title = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';

    const raw = [];
    const slotMap = {};
    const rows = Array.prototype.slice.call(table.querySelectorAll('tr'));

    rows.forEach(function (tr) {
      const th = tr.querySelector('th');
      if (!th) return;
      const label = th.textContent.replace(/\s+/g, ' ').trim();
      const times = label.match(/\d{1,2}:\d{2}/g) || [];
      const mSection = label.match(/第\s*(\d+)\s*节/);
      const mNoon = label.match(/午间\s*(\d+)\s*节/);
      const sectionNo = mSection ? parseInt(mSection[1], 10) : null;
      const customSlot = (!mSection && mNoon && times.length >= 2) ? { start: times[0], end: times[1] } : null;

      if (sectionNo && times.length >= 2 && !slotMap[sectionNo]) {
        slotMap[sectionNo] = { number: sectionNo, startTime: times[0], endTime: times[1] };
      }

      const tds = Array.prototype.slice.call(tr.children).filter(function (el) { return el.tagName === 'TD'; });
      tds.forEach(function (td, idx) {
        const lines = htmlToLines(td.innerHTML);
        if (!lines.length) return;
        const mId = /^(\d+)-(\d+)$/.exec(td.id || '');
        const day = mId ? parseInt(mId[1], 10) : idx + 1;
        splitBlocks(lines).forEach(function (block) {
          raw.push({ day: day, sectionNo: sectionNo, customSlot: customSlot, block: block });
        });
      });
    });

    const timeSlots = Object.keys(slotMap)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .map(function (n) { return slotMap[n]; });

    return { raw: raw, timeSlots: timeSlots, title: title };
  }

  function normalizeCourses(raw) {
    const groups = {};
    const order = [];
    let dropped = 0;

    raw.forEach(function (item) {
      const info = parseBlock(item.block || []);
      if (!info) { dropped++; return; }
      if (!(item.day >= 1 && item.day <= 7)) { dropped++; return; }

      const key = [info.name, info.teacher, info.position, item.day].join('|');
      let g = groups[key];
      if (!g) {
        g = {
          name: info.name,
          teacher: info.teacher,
          position: info.position,
          day: item.day,
          sections: {},
          custom: null,
          customWeeks: {}
        };
        groups[key] = g;
        order.push(key);
      }

      if (item.sectionNo && item.sectionNo > 0) {
        if (!g.sections[item.sectionNo]) g.sections[item.sectionNo] = {};
        info.weeks.forEach(function (w) { g.sections[item.sectionNo][w] = true; });
      } else if (item.customSlot && item.customSlot.start && item.customSlot.end) {
        g.custom = item.customSlot;
        info.weeks.forEach(function (w) { g.customWeeks[w] = true; });
      } else {
        dropped++;
      }
    });

    const out = [];
    order.forEach(function (key) {
      const g = groups[key];
      const nums = Object.keys(g.sections).map(Number).sort(function (a, b) { return a - b; });

      function weeksOf(n) {
        return Object.keys(g.sections[n]).map(Number).sort(function (a, b) { return a - b; });
      }

      let i = 0;
      while (i < nums.length) {
        const baseKey = weeksOf(nums[i]).join(',');
        let j = i;
        while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1 && weeksOf(nums[j + 1]).join(',') === baseKey) {
          j++;
        }
        out.push({
          name: g.name,
          position: g.position,
          teacher: g.teacher,
          day: g.day,
          startSection: nums[i],
          endSection: nums[j],
          weeks: weeksOf(nums[i])
        });
        i = j + 1;
      }

      if (g.custom) {
        const cw = Object.keys(g.customWeeks).map(Number).sort(function (a, b) { return a - b; });
        if (cw.length) {
          out.push({
            name: g.name,
            position: g.position,
            teacher: g.teacher,
            day: g.day,
            isCustomTime: true,
            customStartTime: g.custom.start,
            customEndTime: g.custom.end,
            weeks: cw
          });
        }
      }
    });

    return { courses: out, dropped: dropped };
  }

  async function runImportFlow() {
    const url = resolveTimetableUrl();
    if (!url) {
      throw new Error('未找到课表页，请先在教务系统打开「学生课表 / 我的课表」页面后再导入');
    }

    toast('正在读取课表…');
    const html = await fetchGbk(url);
    const parsed = parseTimetable(html);
    const normalized = normalizeCourses(parsed.raw);
    const courses = normalized.courses;
    if (!courses.length) throw new Error('未解析到任何课程，可能页面需要重新登录或课表结构变化');

    let tip = '将导入 ' + courses.length + ' 条课程记录';
    if (parsed.title) tip += '（' + parsed.title + '）';
    if (normalized.dropped) tip += '，另有 ' + normalized.dropped + ' 条记录信息不全已跳过';
    if (parsed.timeSlots.length) tip += '，并保存 ' + parsed.timeSlots.length + ' 个节次时间';
    const ok = await alert('确认导入', tip + '。是否继续？', '开始导入');
    if (!ok) {
      toast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(courses));
    if (saved === false || saved === 'false') throw new Error('课程保存失败');

    let slotsFailed = false;
    if (parsed.timeSlots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(parsed.timeSlots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + courses.length + ' 条课程' +
      (normalized.dropped ? '，跳过 ' + normalized.dropped + ' 条异常' : '') +
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
