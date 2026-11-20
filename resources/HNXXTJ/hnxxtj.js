(async function main() {
  const bridge = typeof shiguangBridgePromise !== 'undefined' ? await shiguangBridgePromise : null;
  const syncBridge = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;
  const uiSources = [bridge, syncBridge, window];

  function ui(name) {
    for (let i = 0; i < uiSources.length; i++) {
      const s = uiSources[i];
      if (s && typeof s[name] === 'function') return s[name].bind(s);
    }
    return null;
  }

  async function uiAlert(title, content, confirmText) {
    const fn = ui('showAlert');
    if (!fn) return true;
    return (await fn(title, content, confirmText || '确定')) !== false;
  }

  function uiToast(msg) {
    try {
      const fn = ui('showToast');
      if (fn) fn(msg);
    } catch (e) {}
  }

  const abs = (p) => new URL(p, location.origin).href;

  async function fetchText(url, init) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, init || {}));
    if (!res.ok) throw new Error('请求失败(' + res.status + '): ' + url);
    return res.text();
  }

  async function fetchHtmlGbk(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('请求失败(' + res.status + '): ' + url);
    const buf = await res.arrayBuffer();
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch (e) {
      return new TextDecoder().decode(buf);
    }
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  const clean = (s) => String(s == null ? '' : s)
    .replace(/\u00a0|\u2002|\u2009/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  async function fetchAcademicOptions() {
    const pageUrl = '/student/xkjg.wdkb.jsp?menucode=S20301';
    const dropBody = new URLSearchParams({
      comboBoxName: 'StMsXnxqDxDesc', paramValue: '', isYXB: '0',
      isCDDW: '0', isXQ: '0', isDJKSLB: '0', isZY: '0'
    }).toString();

    const results = await Promise.allSettled([
      fetchHtmlGbk(abs(pageUrl)),
      fetchText(abs('/jw/common/showYearTerm.action'), { method: 'POST', body: '' }),
      fetchText(abs('/frame/droplist/getDropLists.action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: dropBody
      })
    ]);

    let xh = '';
    let inline = [];
    if (results[0].status === 'fulfilled') {
      const doc = new DOMParser().parseFromString(results[0].value, 'text/html');
      const xhEl = doc.querySelector('#xh') || doc.querySelector('input[name="xh"]');
      xh = clean(xhEl ? xhEl.value : '');
      inline = Array.from(doc.querySelectorAll('#xnxq option')).map(function (o) {
        return { code: o.value, name: clean(o.textContent) };
      }).filter(function (o) { return o.code && o.name; });
    }

    let term = {};
    if (results[1].status === 'fulfilled') {
      try { term = JSON.parse(results[1].value || '{}'); } catch (e) {}
    }

    let options = [];
    if (results[2].status === 'fulfilled') {
      try { options = JSON.parse(results[2].value || '[]'); } catch (e) {}
    }
    if (!Array.isArray(options)) options = [];
    options = options.filter(function (o) { return o && o.code && o.name; });
    if (!options.length) options = inline;
    if (!options.length) throw new Error('未能读取学年学期下拉选项');

    const curCode = (term.xn || '') + '-' + (term.xqM !== undefined ? term.xqM : (term.xq || ''));
    let defaultIndex = options.findIndex(function (o) { return String(o.code) === curCode; });
    if (defaultIndex < 0) defaultIndex = 0;
    return { options: options, defaultIndex: defaultIndex, xh: xh || term.userCode || '' };
  }

  async function chooseSemester(options, defaultIndex) {
    if (options.length === 1) return options[0];
    const sel = ui('showSingleSelection');
    if (!sel) return null;
    const idx = await sel('选择学年学期', JSON.stringify(options.map(function (o) { return o.name; })), defaultIndex);
    if (idx === null || idx === undefined || idx === -1) return null;
    const i = Number(idx);
    return Number.isInteger(i) && i >= 0 && i < options.length ? options[i] : null;
  }

  const DAYMAP = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
  };
  function dayNum(s) { return DAYMAP[clean(s)] || 0; }

  function expandWeeks(spec, parity) {
    const out = [];
    String(spec || '').split(/[,，、]/).forEach(function (part) {
      const range = part.match(/(\d+)\s*[-－至~]\s*(\d+)/);
      if (range) {
        let a = parseInt(range[1], 10);
        let b = parseInt(range[2], 10);
        if (a > b) { const t = a; a = b; b = t; }
        for (let w = a; w <= b; w++) out.push(w);
      } else {
        const one = part.match(/\d+/);
        if (one) out.push(parseInt(one[0], 10));
      }
    });
    let weeks = Array.from(new Set(out))
      .filter(function (w) { return w >= 1 && w <= 30; })
      .sort(function (a, b) { return a - b; });
    if (parity === '单') weeks = weeks.filter(function (w) { return w % 2 === 1; });
    if (parity === '双') weeks = weeks.filter(function (w) { return w % 2 === 0; });
    return weeks;
  }

  function parseTimePlaces(text, base) {
    const re = /(\d+(?:\s*[,，、\-－]\s*\d+)*)\s*周\s*(?:[（(]\s*([单双])\s*[）)])?\s*([一二三四五六日天])\s*\[\s*(\d+)\s*(?:[-－至]\s*(\d+))?\s*\]/g;
    const ms = [];
    let m;
    while ((m = re.exec(text)) !== null) ms.push(m);
    return ms.map(function (hit, i) {
      const tailEnd = i + 1 < ms.length ? ms[i + 1].index : text.length;
      let place = text.slice(hit.index + hit[0].length, tailEnd);
      place = place.replace(/^[\s,，;；、:：|]+/, '').trim();
      place = place.replace(/\(\d+\)\s*$/, '').trim();
      place = place.replace(/[;；,，、]+$/, '').trim();
      const s = parseInt(hit[4], 10);
      const e = parseInt(hit[5] || hit[4], 10);
      return Object.assign({}, base, {
        day: dayNum(hit[3]), startSection: s, endSection: e >= s ? e : s,
        weeks: expandWeeks(hit[1], hit[2]), position: place
      });
    });
  }

  function parseList(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    for (const tr of doc.querySelectorAll('table tbody tr')) {
      const tds = Array.from(tr.children).filter(function (el) { return el.tagName === 'TD'; });
      if (tds.length < 11) continue;
      const nameRaw = clean(tds[2].textContent);
      const teacherRaw = clean(tds[6].textContent);
      const timeText = clean(tds[10].textContent);
      if (!nameRaw || !timeText) continue;
      const name = nameRaw.replace(/^[^\]]*\]\s*/, '').trim();
      const teacher = teacherRaw.replace(/^[^\]]*\]\s*/, '').trim();
      if (!name) continue;
      out.push.apply(out, parseTimePlaces(timeText, { name: name, teacher: teacher }));
    }
    return out;
  }

  function parseGrid(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#mytable') || doc.querySelector('table');
    if (!table) return [];
    const out = [];
    for (const tr of table.querySelectorAll('tr')) {
      const tds = Array.from(tr.children).filter(function (el) { return el.tagName === 'TD'; });
      const courseCells = tds.filter(function (td) { return String(td.className || '').indexOf('td1') < 0; });
      if (!courseCells.length) continue;
      courseCells.forEach(function (td, idx) {
        for (const div of td.querySelectorAll('div')) {
          if (String(div.className || '').indexOf('div_nokb') >= 0) continue;
          const lines = div.innerHTML.split(/<br\s*\/?>/i).map(function (x) {
            return clean(x.replace(/<[^>]*>/g, ' '));
          }).filter(Boolean);
          if (lines.length < 3) continue;
          const name = lines[0];
          const teacher = lines[1];
          const sm = lines[2].match(/(\d+(?:\s*[-－,，、]\s*\d+)*)\s*周?\s*[（(]?\s*(单|双)?\s*[）)]?\s*\[\s*(\d+)\s*(?:[-－]\s*(\d+))?\s*\]/);
          if (!sm) continue;
          const s = parseInt(sm[3], 10);
          const e = parseInt(sm[4] || sm[3], 10);
          out.push({
            name: name, teacher: teacher, day: idx + 1, startSection: s, endSection: e >= s ? e : s,
            weeks: expandWeeks(sm[1], sm[2]), position: lines[3] || ''
          });
        }
      });
    }
    return out;
  }

  function normalizeCourses(list) {
    const valid = [];
    let bad = 0;
    list.forEach(function (c) {
      if (!c || !c.name || !(c.day >= 1 && c.day <= 7) ||
          !(c.startSection >= 1 && c.endSection >= c.startSection && c.endSection <= 30) ||
          !Array.isArray(c.weeks) || c.weeks.length === 0) {
        bad++;
        return;
      }
      valid.push({
        name: c.name, teacher: c.teacher || '', position: c.position || '',
        day: c.day, startSection: c.startSection, endSection: c.endSection,
        weeks: Array.from(new Set(c.weeks)).sort(function (a, b) { return a - b; })
      });
    });

    const sameWeeks = function (a, b) {
      return a.length === b.length && a.every(function (w, i) { return w === b[i]; });
    };

    const step1 = [];
    valid.forEach(function (c) {
      const hit = step1.find(function (x) {
        return x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
          x.day === c.day && sameWeeks(x.weeks, c.weeks) && c.startSection === x.endSection + 1;
      });
      if (hit) hit.endSection = c.endSection;
      else step1.push(c);
    });

    const step2 = [];
    step1.forEach(function (c) {
      const hit = step2.find(function (x) {
        return x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
          x.day === c.day && x.startSection === c.startSection && x.endSection === c.endSection;
      });
      if (hit) hit.weeks = Array.from(new Set(hit.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      else step2.push(c);
    });
    return { courses: step2, bad: bad };
  }

  async function runImportFlow() {
    const go = await uiAlert('课表导入', '将从个人课表接口读取所选学期的整学期课程，是否继续？', '继续');
    if (!go) {
      uiToast('已取消，未导入');
      return;
    }

    const aca = await fetchAcademicOptions();
    const semester = await chooseSemester(aca.options, aca.defaultIndex);
    if (!semester) {
      uiToast('已取消，未导入');
      return;
    }

    const parts = String(semester.code).split('-');
    const xn = parts[0];
    const xq = parts[1];
    if (!xn || xq === undefined || !aca.xh) throw new Error('缺少学年/学期/学号参数，请重新登录后重试');

    const params = utf8ToBase64('xn=' + xn + '&xq=' + xq + '&xh=' + aca.xh);
    const query = '?params=' + encodeURIComponent(params);
    const [listRes, gridRes] = await Promise.allSettled([
      fetchHtmlGbk(abs('/wsxk/xkjg.ckdgxsxdkchj_data10319.jsp' + query)),
      fetchHtmlGbk(abs('/student/wsxk.xskcb10319.jsp' + query))
    ]);

    let raw = [];
    let source = '';
    if (listRes.status === 'fulfilled') {
      raw = parseList(listRes.value);
      if (raw.length) source = '列表接口';
    }
    if (!raw.length && gridRes.status === 'fulfilled') {
      raw = parseGrid(gridRes.value);
      if (raw.length) source = '二维表接口';
    }
    if (!raw.length) throw new Error('课表接口未返回可解析的课程');

    const result = normalizeCourses(raw);
    if (!result.courses.length) throw new Error('课程校验后为空');

    const confirmed = await uiAlert(
      '确认导入',
      '学期：' + semester.name +
        '\n来源：' + source +
        '\n课程：' + result.courses.length + ' 门' +
        (result.bad > 0 ? '（跳过异常 ' + result.bad + ' 条）' : '') +
        '\n作息：未包含，使用默认时间' +
        '\n\n导入会覆盖当前课表。',
      '导入'
    );
    if (!confirmed) {
      uiToast('已取消，未导入');
      return;
    }

    if (!bridge || typeof bridge.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await bridge.saveImportedCourses(JSON.stringify(result.courses));
    if (saved === false || saved === 'false') throw new Error('课程保存失败');

    if (syncBridge && typeof syncBridge.notifyTaskCompletion === 'function') syncBridge.notifyTaskCompletion();
    uiToast('已从' + source + '导入 ' + result.courses.length + ' 门课' +
      (result.bad ? '，跳过 ' + result.bad + ' 条异常数据' : '') + '（作息未写入）');
  }

  try {
    await runImportFlow();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await uiAlert('导入失败', msg, '知道了');
    uiToast('导入失败：' + msg);
  }
})();
