// 湖北第二师范学院（HBUE）青果教务课表适配器
// 使用方法：登录教务系统后直接运行，不需要手动进入课表页；
// 脚本会自己请求学期下拉框与整学期课表、作息。

(async () => {
  const BASE = location.origin + '/jsxsd';
  const PAGE_URL = BASE + '/xskb/xskb_list.do?zc=';
  const bp = (typeof shiguangBridgePromise !== 'undefined' && shiguangBridgePromise) ||
    (typeof window !== 'undefined' ? window.shiguangBridgePromise : null);
  const bridge = (typeof window !== 'undefined' && window.shiguangBridge) ||
    (typeof shiguangBridge !== 'undefined' ? shiguangBridge : null);

  async function toast(msg) {
    if (bridge && typeof bridge.showToast === 'function') {
      try { return bridge.showToast(msg); } catch (e) { /* ignore */ }
    }
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      return window.showToast(msg);
    }
  }

  async function alertDialog(title, content, confirmText) {
    if (bp && typeof bp.showAlert === 'function') {
      return await bp.showAlert(title, content, confirmText);
    }
    if (typeof window !== 'undefined' && typeof window.showAlert === 'function') {
      return await window.showAlert(title, content, confirmText);
    }
    return true;
  }

  async function chooseSemester(items, def) {
    if (!bp || typeof bp.showSingleSelection !== 'function') return def;
    const labels = items.map((x) => x.text);
    const r = await bp.showSingleSelection('选择学期', JSON.stringify(labels), def);
    if (r === null || r === -1 || typeof r !== 'number') return -1;
    return r;
  }

  function cleanHtml(s) {
    return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  }

  function expandWeeks(text) {
    const set = new Set();
    String(text).split(/[,，、]/).forEach((p) => {
      p = p.trim();
      const m = p.match(/^(\d+)\s*[-~—]\s*(\d+)$/);
      if (m) {
        let a = +m[1], b = +m[2];
        if (a > b) { const t = a; a = b; b = t; }
        for (let i = a; i <= b; i++) set.add(i);
      } else if (/^\d+$/.test(p)) {
        set.add(+p);
      }
    });
    return Array.from(set).filter((w) => w >= 1 && w <= 30).sort((a, b) => a - b);
  }

  function parseSegment(seg, day) {
    const weekM = seg.match(/<font title=['"]周次\(节次\)['"]>([\s\S]*?)<\/font>/i);
    if (!weekM) return null;
    const teacherM = seg.match(/<font title=['"]老师['"]>([\s\S]*?)<\/font>/i);
    const roomM = seg.match(/<font title=['"]教室['"]>([\s\S]*?)<\/font>/i);
    const namePart = seg.slice(0, weekM.index)
      .replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<font\b[^>]*>[\s\S]*?<\/font>/gi, '');
    const name = cleanHtml(namePart);
    if (!name) return null;
    const wt = cleanHtml(weekM[1]);
    const weeksM = wt.match(/([0-9,，、\-~—]+)\s*周/);
    const secM = wt.match(/\[\s*(\d+)\s*(?:-\s*(\d+))?\s*节\s*\]/) ||
      wt.match(/(\d+)\s*(?:-\s*(\d+))?\s*节/);
    if (!weeksM || !secM) return null;
    const odd = /单/.test(wt);
    const even = /双/.test(wt);
    let weeks = expandWeeks(weeksM[1]);
    if (odd && !even) weeks = weeks.filter((w) => w % 2 === 1);
    if (even && !odd) weeks = weeks.filter((w) => w % 2 === 0);
    if (!weeks.length) return null;
    return {
      name: name,
      position: roomM ? cleanHtml(roomM[1]) : '',
      teacher: teacherM ? cleanHtml(teacherM[1]) : '',
      day: day,
      startSection: +secM[1],
      endSection: secM[2] ? +secM[2] : +secM[1],
      weeks: weeks
    };
  }

  function parseCourses(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#kbtable');
    if (!table) return [];
    const rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
    const out = [];
    for (const row of rows) {
      const kids = Array.prototype.slice.call(row.children);
      for (let i = 0; i < kids.length; i++) {
        if (kids[i].tagName !== 'TD') continue;
        const day = i;
        if (day < 1 || day > 7) continue;
        const divs = Array.prototype.slice.call(kids[i].querySelectorAll('div'));
        const detail = divs.find((d) => String(d.className || '').trim() === 'kbcontent');
        if (!detail) continue;
        const segs = (detail.innerHTML || '').split(/-----{3,}/);
        for (const seg of segs) {
          const c = parseSegment(seg, day);
          if (c) out.push(c);
        }
      }
    }
    return out;
  }

  function parseTimeSlots(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#kbtable');
    if (!table) return [];
    const blocks = [];
    const rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
    for (const row of rows) {
      const th = row.querySelector('th');
      if (!th) continue;
      const txt = (th.textContent || '').replace(/\s+/g, ' ').trim();
      const tm = txt.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      const rm = txt.match(/(\d+)\s*-\s*(\d+)\s*节/) || txt.match(/(\d+)\s*节/);
      if (!tm || !rm) continue;
      blocks.push({
        s: +rm[1],
        e: rm[2] ? +rm[2] : +rm[1],
        from: tm[1],
        to: tm[2]
      });
    }
    if (!blocks.length) return [];
    const toMin = (t) => {
      const p = t.split(':').map(Number);
      return p[0] * 60 + p[1];
    };
    const toStr = (m) => {
      const v = Math.round(m);
      return String(Math.floor(v / 60)).padStart(2, '0') + ':' +
        String(v % 60).padStart(2, '0');
    };
    const single = blocks.find((b) => b.s === b.e);
    let dur = single ? toMin(single.to) - toMin(single.from) : 45;
    const slots = [];
    for (const b of blocks) {
      const total = toMin(b.to) - toMin(b.from);
      const n = b.e - b.s + 1;
      if (n <= 0 || total <= 0) continue;
      let brk = n > 1 ? (total - dur * n) / (n - 1) : 0;
      if (dur <= 0 || brk < 0) {
        dur = Math.floor(total / n);
        brk = n > 1 ? (total - dur * n) / (n - 1) : 0;
      }
      let cur = toMin(b.from);
      for (let k = b.s; k <= b.e; k++) {
        slots.push({ number: k, startTime: toStr(cur), endTime: toStr(cur + dur) });
        cur = cur + dur + brk;
      }
    }
    slots.sort((a, b) => a.number - b.number);
    return slots;
  }

  function normalizeCourses(list) {
    const valid = [];
    let badCount = 0;
    for (const c of list) {
      if (!c.name || !(c.day >= 1 && c.day <= 7) || !(c.startSection >= 1) ||
        !(c.endSection >= c.startSection) || !Array.isArray(c.weeks) || !c.weeks.length) {
        badCount++;
        continue;
      }
      valid.push({
        name: c.name,
        position: c.position || '',
        teacher: c.teacher || '',
        day: c.day,
        startSection: c.startSection,
        endSection: c.endSection,
        weeks: Array.from(new Set(c.weeks)).sort((a, b) => a - b)
      });
    }
    // 阶段一：同课同周次、节次连续 -> 合并节次
    const g1 = new Map();
    for (const c of valid) {
      const k = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      if (!g1.has(k)) g1.set(k, []);
      g1.get(k).push(c);
    }
    const step1 = [];
    for (const arr of g1.values()) {
      arr.sort((a, b) => a.startSection - b.startSection);
      let cur = Object.assign({}, arr[0]);
      for (let i = 1; i < arr.length; i++) {
        const n = arr[i];
        if (n.startSection === cur.endSection + 1) {
          cur.endSection = n.endSection;
        } else {
          step1.push(cur);
          cur = Object.assign({}, n);
        }
      }
      step1.push(cur);
    }
    // 阶段二：同课同节次 -> 周次取并集
    const g2 = new Map();
    for (const c of step1) {
      const k = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!g2.has(k)) g2.set(k, Object.assign({}, c, { weeks: [] }));
      const t = g2.get(k);
      t.weeks = Array.from(new Set(t.weeks.concat(c.weeks))).sort((a, b) => a - b);
    }
    return { courses: Array.from(g2.values()), badCount: badCount };
  }

  async function fetchHtml(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('请求失败 ' + res.status);
    return res.text();
  }

  async function runImportFlow() {
    try {
      const ok = await alertDialog(
        '课表导入',
        '将读取教务系统整学期课表与作息，继续吗？',
        '开始导入'
      );
      if (ok === false) {
        await toast('已取消导入');
        return;
      }

      let html = await fetchHtml(PAGE_URL);
      let doc = new DOMParser().parseFromString(html, 'text/html');
      let table = doc.querySelector('#kbtable');
      let termSelect = doc.querySelector('#xnxq01id, select[name="xnxq01id"]');

      if (!table && termSelect) {
        const fallback = termSelect.options[termSelect.selectedIndex];
        if (fallback && fallback.value) {
          html = await fetchHtml(BASE + '/xskb/xskb_list.do?xnxq01id=' +
            encodeURIComponent(fallback.value) + '&zc=');
          doc = new DOMParser().parseFromString(html, 'text/html');
          table = doc.querySelector('#kbtable');
          termSelect = doc.querySelector('#xnxq01id, select[name="xnxq01id"]');
        }
      }
      if (!table) throw new Error('未找到课表，请确认已登录教务系统');

      if (termSelect) {
        const validOptions = Array.from(termSelect.options).filter((o) => o.value);
        const items = validOptions.map((o) => ({
          value: o.value,
          text: (o.textContent || '').trim()
        }));
        if (items.length > 1) {
          let def = validOptions.findIndex((o) => o.selected);
          def = Math.max(0, def);
          const idx = await chooseSemester(items, def);
          if (idx < 0) {
            await toast('已取消导入');
            return;
          }
          const currentValue =
            (validOptions.find((o) => o.selected) || validOptions[0] || {}).value || '';
          const target = items[idx] ? items[idx].value : '';
          if (target && target !== currentValue) {
            html = await fetchHtml(BASE + '/xskb/xskb_list.do?xnxq01id=' +
              encodeURIComponent(target) + '&zc=');
            doc = new DOMParser().parseFromString(html, 'text/html');
            table = doc.querySelector('#kbtable');
            if (!table) throw new Error('切换学期失败，请刷新后重试');
          }
        }
      }

      const raw = parseCourses(html);
      const norm = normalizeCourses(raw);
      if (!norm.courses.length) {
        throw new Error('未解析到课程，可能登录已失效或该学期无课表');
      }

      const saved = await bp.saveImportedCourses(JSON.stringify(norm.courses));
      if (saved === null || saved === false) throw new Error('课程保存失败');

      const slots = parseTimeSlots(html);
      let slotCount = 0;
      if (slots.length) {
        const slotsSaved = await bp.savePresetTimeSlots(JSON.stringify(slots));
        if (slotsSaved !== null && slotsSaved !== false) slotCount = slots.length;
      }

      const slotNote = slotCount ? ('，作息 ' + slotCount + ' 节') : '';
      const skipNote = norm.badCount ? ('，跳过 ' + norm.badCount + ' 条异常记录') : '';
      await toast('已导入 ' + norm.courses.length + ' 门课' + slotNote + skipNote);
      if (bridge && typeof bridge.notifyTaskCompletion === 'function') {
        bridge.notifyTaskCompletion();
      }
    } catch (err) {
      await toast('导入失败：' + (err && err.message ? err.message : String(err)));
    }
  }

  runImportFlow();
})();
