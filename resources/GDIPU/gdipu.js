(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BD = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  function toast(msg) {
    if (BD && typeof BD.showToast === 'function') { try { BD.showToast(msg); } catch (e) {} }
  }
  async function alert(title, content, confirmText) {
    if (!BP || typeof BP.showAlert !== 'function') return true;
    return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
  }
  async function select(title, labels, def) {
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    const picked = await BP.showSingleSelection(title, JSON.stringify(labels), def);
    if (picked === null || picked === undefined || Number(picked) === -1 || isNaN(Number(picked))) return null;
    return Number(picked);
  }
  async function saveCourses(courses) {
    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const ok = await BP.saveImportedCourses(JSON.stringify(courses));
    if (ok === false || ok === 'false' || ok === null) throw new Error('课程保存失败');
  }
  function finish() {
    if (BD && typeof BD.notifyTaskCompletion === 'function') { try { BD.notifyTaskCompletion(); } catch (e) {} }
  }

  try {
  const BASE = location.origin;
  const LIST_URL = BASE + '/jsxsd/xskb/xskb_list.do';

  const fetchText = async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('请求失败 ' + r.status + ' ' + url);
    return await r.text();
  };

  // ---------- 1. 取课表查询页，解析学年学期 / 节次模式下拉框 ----------
  const firstHtml = await fetchText(LIST_URL);
  const firstDoc = new DOMParser().parseFromString(firstHtml, 'text/html');
  if (/错误提示页面|非法访问|请先登录|login/i.test(firstDoc.title || '')) {
    throw new Error('未登录或会话已过期，请在页面上重新登录后再试');
  }
  const semSel = firstDoc.querySelector('#xnxq01id');
  if (!semSel) throw new Error('未找到学年学期选择框，请先进入「学期理论课表」页面');
  const semOptions = Array.from(semSel.options)
    .map(o => ({ value: o.value, text: (o.textContent || '').replace(/\s+/g, ' ').trim() }))
    .filter(o => o.value);
  if (!semOptions.length) throw new Error('学年学期下拉框为空');
  const defIdx = Math.max(0, Math.min(semSel.selectedIndex, semOptions.length - 1));

  const modeSel = firstDoc.querySelector('#kbjcmsid');
  const modeVal = modeSel && modeSel.value ? modeSel.value : '';

  // ---------- 2. 让用户选学期 ----------
  const pick = await select('选择要导入的学期', semOptions.map(o => o.text), defIdx);
  if (pick === null) { toast('已取消导入'); return; }
  const chosen = semOptions[pick];
  if (!chosen) throw new Error('学期选择无效');

  const ok = await alert('确认导入', '将导入「' + chosen.text + '」整学期课表，是否继续？', '开始导入');
  if (!ok) { toast('已取消导入'); return; }

  // ---------- 3. 按学期重新请求整学期课表 ----------
  const qs = new URLSearchParams();
  qs.set('xnxq01id', chosen.value);
  qs.set('zc', '');
  qs.set('xqid', '');
  if (modeVal) qs.set('kbjcmsid', modeVal);
  const html = await fetchText(LIST_URL + '?' + qs.toString());
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const semSel2 = doc.querySelector('#xnxq01id');
  if (!semSel2) throw new Error('切换学期后返回的页面结构异常，可能已退出登录');
  if (semSel2.value && semSel2.value !== chosen.value) {
    throw new Error('学期切换失败（下拉框仍为 ' + semSel2.value + '），请在页面上手动切换后重试');
  }

  const table = doc.querySelector('#kbtable');
  if (!table) throw new Error('未找到课表表格 #kbtable，页面可能不是学期理论课表');

  // ---------- 4. 解析 ----------
  const toMin = (t) => { const p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); };
  const toStr = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

  const slotMap = {}; // 节次 -> {number,startTime,endTime}
  const fillSlots = (s, e, t1, t2) => {
    const n = e - s + 1;
    if (n <= 0) return;
    const start = toMin(t1), end = toMin(t2), total = end - start;
    if (!(total > 0)) return;
    let gap = 5;
    let per = Math.round((total - gap * (n - 1)) / n);
    if (per <= 0 || per * n + gap * (n - 1) !== total) { gap = 0; per = Math.floor(total / n); }
    if (per <= 0) return;
    let cur = start;
    for (let k = 0; k < n; k++) {
      const num = s + k;
      if (!slotMap[num]) slotMap[num] = { number: num, startTime: toStr(cur), endTime: toStr(cur + per) };
      cur += per + gap;
    }
  };

  const parseWeeks = (s) => {
    const m = s.match(/([0-9,\-]+)\s*\(\s*周\s*\)/);
    let body = m ? m[1] : s.split('[')[0];
    body = body.replace(/周/g, '');
    const out = [];
    for (const part of body.split(',')) {
      const p = part.trim();
      if (!p) continue;
      const r = p.match(/^(\d+)\s*-\s*(\d+)$/);
      if (r) { for (let w = Number(r[1]); w <= Math.min(Number(r[2]), 30); w++) out.push(w); }
      else if (/^\d+$/.test(p)) { const w = Number(p); if (w >= 1 && w <= 30) out.push(w); }
    }
    return Array.from(new Set(out)).filter(w => w > 0).sort((a, b) => a - b);
  };

  const parseSections = (s, fbStart, fbEnd) => {
    const m = s.match(/\[([0-9\-]+)\s*节\]/);
    if (m) {
      const nums = m[1].split('-').filter(x => x !== '').map(Number).filter(n => n > 0);
      if (nums.length >= 2) return { start: Math.min(...nums), end: Math.max(...nums) };
      if (nums.length === 1) return { start: nums[0], end: nums[0] };
    }
    return { start: fbStart, end: fbEnd };
  };

  const raw = [];
  let bad = 0;

  const rows = Array.from(table.querySelectorAll('tr'));
  for (const tr of rows) {
    const th = tr.querySelector('th');
    const tds = Array.from(tr.children).filter(el => el.tagName === 'TD');
    if (!th || tds.length < 7) continue;
    const thText = (th.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const mSec = thText.match(/第\s*(\d+)\s*-\s*(\d+)\s*节/);
    if (!mSec) continue;
    const rowStart = Number(mSec[1]), rowEnd = Number(mSec[2]);
    const mTime = thText.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (mTime) fillSlots(rowStart, rowEnd, mTime[1], mTime[2]);

    tds.forEach((td, idx) => {
      const day = idx + 1;
      if (day > 7) return;
      const cell = td.querySelector('.kbcontent') || td.querySelector('.kbcontent1');
      if (!cell) return;
      const inner = cell.innerHTML || '';
      if (!inner.trim() || !/[^\s\u00a0]/.test((cell.textContent || '').replace(/[\s\u00a0]/g, ''))) return;

      for (const segHtml of inner.split(/-{5,}/)) {
        if (!segHtml || !/[^\s]/.test(segHtml)) continue;
        const segDoc = new DOMParser().parseFromString('<div id="seg">' + segHtml + '</div>', 'text/html');
        const holder = segDoc.getElementById('seg');
        if (!holder) continue;

        let teacher = '', weeksRaw = '', room = '';
        Array.from(holder.querySelectorAll('font[title]')).forEach(f => {
          const t = f.getAttribute('title') || '';
          const v = (f.textContent || '').replace(/\u00a0/g, ' ').trim();
          if (t === '老师') teacher = v;
          else if (t.indexOf('周次') >= 0) weeksRaw = v;
          else if (t === '教室') room = v;
        });

        const clone = holder.cloneNode(true);
        Array.from(clone.querySelectorAll('font')).forEach(f => f.remove());
        const name = (clone.textContent || '').replace(/[\s\u00a0]+/g, '').trim();
        if (!name) { bad++; continue; }

        const weeks = parseWeeks(weeksRaw);
        if (!weeks.length) { bad++; continue; }
        const sec = parseSections(weeksRaw, rowStart, rowEnd);
        if (!(sec.start >= 1) || !(sec.end >= sec.start)) { bad++; continue; }

        raw.push({
          name,
          position: room || '',
          teacher: teacher || '',
          day,
          startSection: sec.start,
          endSection: sec.end,
          weeks
        });
      }
    });
  }

  // ---------- 5. 校验 + 两阶段合并 ----------
  const valid = raw.filter(c =>
    c.day >= 1 && c.day <= 7 &&
    c.startSection >= 1 && c.endSection >= c.startSection &&
    Array.isArray(c.weeks) && c.weeks.length > 0
  );
  bad += raw.length - valid.length;

  const map1 = new Map();
  for (const c of valid) {
    const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
    if (!map1.has(key)) map1.set(key, { ...c, weeks: new Set(c.weeks) });
    else { const e = map1.get(key); c.weeks.forEach(w => e.weeks.add(w)); }
  }
  let list = Array.from(map1.values()).map(c => ({
    ...c, weeks: Array.from(c.weeks).sort((a, b) => a - b)
  }));

  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = list[i], b = list[j];
        if (a.name !== b.name || a.teacher !== b.teacher || a.position !== b.position || a.day !== b.day) continue;
        if (a.weeks.join(',') !== b.weeks.join(',')) continue;
        if (a.endSection + 1 === b.startSection) {
          list[i] = { ...a, endSection: b.endSection };
          list.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  if (!list.length) throw new Error('未解析到任何课程（该学期可能没有课表，或页面结构已变更）');

  // ---------- 6. 保存 ----------
  await saveCourses(list);

  const slots = Object.keys(slotMap)
    .map(k => Number(k))
    .sort((a, b) => a - b)
    .map(n => slotMap[n]);
  if (slots.length) {
    try { await BP.savePresetTimeSlots(JSON.stringify(slots)); } catch (e) {}
  }

  const names = Array.from(new Set(list.map(c => c.name)));
  toast('已导入 ' + chosen.text + '：' + list.length + ' 条课程安排（' + names.length + ' 门课）' +
    (slots.length ? '，含 ' + slots.length + ' 节作息' : '') +
    (bad ? '，跳过 ' + bad + ' 条异常记录' : ''));
  finish();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
