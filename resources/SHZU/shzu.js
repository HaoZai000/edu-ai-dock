(async function main() {
  const PAGE = '/jsxsd/xskb/xskb_list.do';

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

  async function getText(path) {
    const r = await fetch(location.origin + path, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw new Error('请求失败(' + r.status + ')，请确认已登录');
    return await r.text();
  }

  async function postForm(path, body) {
    const r = await fetch(location.origin + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body
    });
    if (!r.ok) throw new Error('请求失败(' + r.status + ')，请确认已登录');
    return await r.text();
  }

  function selectOptions(select) {
    if (!select || !select.options) return [];
    return Array.from(select.options)
      .map(function (o, i) {
        return {
          label: String(o.textContent || '').trim(),
          value: String(o.value || '').trim(),
          index: i,
          selected: o.hasAttribute ? o.hasAttribute('selected') : false
        };
      })
      .filter(function (o) { return o.value; });
  }

  function minutes(s) {
    const p = String(s).split(':').map(Number);
    return p[0] * 60 + p[1];
  }

  function hm(m) {
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function parseSectionSpan(text) {
    const t = String(text || '');
    const m = t.match(/(\d+)\s*[,，\-~至到]\s*(\d+)\s*(?:小节|节)/) || t.match(/\(([\d,，\-~至到]+)\s*小节\)/);
    if (m) {
      const nums = (m[1] + '-' + (m[2] || '')).match(/\d+/g) || m[1].match(/\d+/g) || [];
      if (nums.length) {
        const a = Number(nums[0]);
        const b = Number(nums[nums.length - 1]);
        if (a >= 1 && b >= a) return [a, b];
      }
    }
    const one = t.match(/第?\s*(\d+)\s*节/);
    return one ? [Number(one[1]), Number(one[1])] : null;
  }

  function buildSlots(doc) {
    const map = new Map();
    Array.from(doc.querySelectorAll('#timetable tr')).forEach(function (row) {
      const th = row.querySelector('th');
      if (!th) return;
      const text = th.textContent.replace(/\s+/g, ' ');
      const span = parseSectionSpan(text);
      const tm = text.match(/(\d{1,2}:\d{2})\s*[-~－—]\s*(\d{1,2}:\d{2})/);
      if (!span || !tm) return;
      const a = span[0];
      const b = span[1];
      const count = b - a + 1;
      const start = minutes(tm[1]);
      const total = minutes(tm[2]) - start;
      if (count < 1 || total <= 0) return;
      const gap = count > 1 ? 10 : 0;
      const per = Math.floor((total - gap * (count - 1)) / count);
      if (per < 20) return;
      for (let n = a; n <= b; n++) {
        if (map.has(n)) continue;
        const off = (n - a) * (per + gap);
        map.set(n, { number: n, startTime: hm(start + off), endTime: hm(start + off + per) });
      }
    });
    return Array.from(map.values()).sort(function (a, b) { return a.number - b.number; });
  }

  function expandWeeks(s) {
    const out = new Set();
    String(s || '').replace(/[周第\s]/g, '').split(/[,，、;；]/).forEach(function (piece) {
      const p = piece.trim();
      if (!p) return;
      const r = p.match(/^(\d+)\s*[-~至到]\s*(\d+)$/);
      if (r) {
        const a = Number(r[1]);
        const b = Number(r[2]);
        for (let w = Math.min(a, b); w <= Math.max(a, b) && w <= 30; w++) if (w >= 1) out.add(w);
        return;
      }
      const n = p.match(/\d+/);
      if (n) {
        const w = Number(n[0]);
        if (w >= 1 && w <= 30) out.add(w);
      }
    });
    return Array.from(out).sort(function (a, b) { return a - b; });
  }

  function parseCourses(doc) {
    const raw = [];
    const rejected = [];
    const table = doc.querySelector('#timetable');
    if (!table) return { raw: raw, rejected: rejected };

    Array.from(table.querySelectorAll('tr')).forEach(function (row) {
      const cells = Array.from(row.children || []);
      const tds = cells.filter(function (c) { return c.tagName === 'TD'; });
      if (tds.length < 7) return;
      const th = cells.find(function (c) { return c.tagName === 'TH'; });
      const rowSpan = th ? parseSectionSpan(th.textContent) : null;
      const rowSecs = rowSpan ? [rowSpan[0], rowSpan[1]] : [];

      for (let i = 0; i < 7; i++) {
        const divs = Array.from(tds[i].querySelectorAll('div')).filter(function (d) {
          return d.className && String(d.className).split(/\s+/).indexOf('kbcontent') >= 0;
        });
        divs.forEach(function (div) {
          String(div.innerHTML || '').split(/-{5,}/).forEach(function (part) {
            if (!/周/.test(part)) return;
            const tmp = doc.createElement('div');
            tmp.innerHTML = part;
            const fonts = Array.from(tmp.querySelectorAll('font'));
            const wk = fonts.find(function (f) { return f.getAttribute && f.getAttribute('title') === '周次(节次)'; });
            if (!wk) return;
            const name = fonts.length ? fonts[0].textContent.replace(/\s+/g, ' ').trim() : '';
            if (!name) return;

            const wt = wk.textContent.replace(/\s+/g, '');
            const weekPart = wt.split('[')[0].split('(')[0];
            let weeks = expandWeeks(weekPart);
            if (/\(单|单周/.test(wt)) weeks = weeks.filter(function (w) { return w % 2 === 1; });
            else if (/\(双|双周/.test(wt)) weeks = weeks.filter(function (w) { return w % 2 === 0; });

            const st = (wt.match(/\[([^\]]*)\]/) || [])[1] || '';
            let secs = (st.match(/\d+/g) || []).map(Number);
            if (!secs.length) secs = rowSecs.slice();
            const teacher = fonts.find(function (f) { return f.getAttribute && f.getAttribute('title') === '教师'; });
            const pos = fonts.find(function (f) { return f.getAttribute && f.getAttribute('title') === '教室'; });

            if (!weeks.length || !secs.length) {
              rejected.push(name);
              return;
            }
            raw.push({
              name: name,
              position: pos ? pos.textContent.trim() : '',
              teacher: teacher ? teacher.textContent.trim() : '',
              day: i + 1,
              startSection: Math.min.apply(null, secs),
              endSection: Math.max.apply(null, secs),
              weeks: weeks
            });
          });
        });
      }
    });
    return { raw: raw, rejected: rejected };
  }

  function normalizeCourses(list) {
    const valid = [];
    const skipped = [];
    list.forEach(function (c) {
      const day = Number(c.day);
      const s = Number(c.startSection);
      const e = Number(c.endSection);
      const weeks = Array.from(new Set((c.weeks || []).filter(function (w) {
        return Number.isInteger(w) && w >= 1 && w <= 30;
      }))).sort(function (a, b) { return a - b; });
      if (!c.name || !(day >= 1 && day <= 7) || !(s >= 1) || !(e >= s) || e > 30 || !weeks.length) {
        skipped.push(c.name || '(无课程名)');
        return;
      }
      valid.push({
        name: c.name, position: c.position || '', teacher: c.teacher || '',
        day: day, startSection: s, endSection: e, weeks: weeks
      });
    });

    valid.sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });

    const key1 = function (c) { return [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('\u0001'); };
    const stage1 = [];
    valid.forEach(function (c) {
      let hit = null;
      for (const m of stage1) {
        if (key1(m) === key1(c) && c.startSection <= m.endSection + 1) { hit = m; break; }
      }
      if (hit) {
        hit.startSection = Math.min(hit.startSection, c.startSection);
        hit.endSection = Math.max(hit.endSection, c.endSection);
      } else {
        stage1.push(Object.assign({}, c, { weeks: c.weeks.slice() }));
      }
    });

    const key2 = function (c) {
      return [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('\u0001');
    };
    const courses = [];
    stage1.forEach(function (c) {
      let hit = null;
      for (const x of courses) if (key2(x) === key2(c)) { hit = x; break; }
      if (hit) {
        hit.weeks = Array.from(new Set(hit.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      } else {
        courses.push(Object.assign({}, c, { weeks: c.weeks.slice() }));
      }
    });
    return { courses: courses, skipped: skipped };
  }

  async function runImportFlow() {
    const go = await alert('课表导入', '将读取当前学期整学期课表并导入，是否继续？', '继续');
    if (!go) {
      toast('已取消，未导入');
      return;
    }

    const base = new DOMParser().parseFromString(await getText(PAGE), 'text/html');
    const semesterSelect = base.querySelector('#xnxq01id');
    const options = selectOptions(semesterSelect);
    if (!options.length) throw new Error('页面上没有找到学期选项，请重新登录后重试');

    const def = Math.max(0, options.findIndex(function (o) { return o.selected; }));
    const picked = await choose('选择学期', options.map(function (o) { return o.label; }), def);
    if (picked < 0) {
      toast('已取消，未导入');
      return;
    }
    const chosen = options[picked];
    const modeEl = base.querySelector('#kbjcmsid');
    const body = new URLSearchParams({
      zc: '',
      xnxq01id: chosen.value,
      kbjcmsid: modeEl ? String(modeEl.value || '') : '',
      sfFD: '1',
      wkbkc: '1',
      demo: '',
      cj0701id: ''
    }).toString();

    const html = await postForm(PAGE, body);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const backSelect = doc.querySelector('#xnxq01id');
    const back = selectOptions(backSelect).find(function (o) { return o.selected; });
    if (!back || back.value !== chosen.value) throw new Error('学期切换失败，请重新登录后重试');

    const slots = buildSlots(doc);
    const parsed = parseCourses(doc);
    const norm = normalizeCourses(parsed.raw);
    if (!norm.courses.length) throw new Error('课表页面没有解析到课程，请确认当前账号有排课');

    const confirmed = await alert(
      '确认导入',
      '学期：' + chosen.label +
        '\n课程：' + norm.courses.length + ' 门' +
        (norm.skipped.length ? '\n跳过异常：' + norm.skipped.length + ' 条' : '') +
        '\n作息：' + (slots.length ? slots.length + ' 节' : '未取到') +
        '\n\n导入会覆盖当前课表。',
      '导入'
    );
    if (!confirmed) {
      toast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(norm.courses));
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
    toast('导入完成：' + norm.courses.length + ' 门课' +
      (norm.skipped.length ? '，跳过 ' + norm.skipped.length + ' 条异常' : '') +
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
