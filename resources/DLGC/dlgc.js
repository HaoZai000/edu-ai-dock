(async function () {
  'use strict';

  var BP = window.shiguangBridgePromise;
  var BR = window.shiguangBridge;
  var HAS_BP = !!(BP && typeof BP.showAlert === 'function');
  var BASE = location.origin + '/jwapp/sys/wdkb/modules';

  // 学校作息（12 小节），来自教务课表设置
  var DEFAULT_SLOTS = [
    ['08:10', '08:55'],
    ['09:05', '09:50'],
    ['10:10', '10:55'],
    ['11:05', '11:50'],
    ['12:00', '12:45'],
    ['14:00', '14:45'],
    ['14:55', '15:40'],
    ['16:00', '16:45'],
    ['17:45', '18:30'],
    ['18:40', '19:25'],
    ['19:35', '20:20'],
    ['20:30', '21:15']
  ];

  function toast(msg) {
    try {
      if (BR && typeof BR.showToast === 'function') BR.showToast(msg);
    } catch (e) {}
  }

  function alertBox(title, content, btn) {
    if (!HAS_BP || typeof BP.showAlert !== 'function') return Promise.resolve(true);
    return Promise.resolve(BP.showAlert(title, content, btn || '知道了'));
  }

  function choose(title, items, def) {
    if (!HAS_BP || typeof BP.showSingleSelection !== 'function') return Promise.resolve(def);
    return Promise.resolve(BP.showSingleSelection(title, JSON.stringify(items), def == null ? 0 : def));
  }

  function fail(msg) {
    throw new Error(msg);
  }

  function val(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return '';
  }

  // 递归收集对象，兼容不同的返回包裹
  function collectObjects(root) {
    var out = [];
    var seen = [];
    function walk(v, depth) {
      if (!v || depth > 6 || typeof v !== 'object') return;
      if (seen.indexOf(v) >= 0) return;
      seen.push(v);
      if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i++) walk(v[i], depth + 1);
        return;
      }
      out.push(v);
      for (var k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k], depth + 1);
      }
    }
    walk(root, 0);
    return out;
  }

  async function getJSON(url) {
    var res = await fetch(url, { credentials: 'include' });
    var text = await res.text();
    if (!res.ok) fail('请求失败（' + res.status + '）：' + url);
    try {
      return JSON.parse(text);
    } catch (e) {
      fail('接口返回不是 JSON，登录可能已失效：' + url);
    }
  }

  function semesterCode(obj) {
    var code = String(val(obj, ['XNXQDM', 'xnxqdm', 'XNXQDM_DISPLAY']) || '');
    return /^\d{4}-\d{4}-[12]$/.test(code) ? code : '';
  }

  async function fetchSemesters() {
    var urls = [BASE + '/jshkcb/xnxqcx.do', BASE + '/jshkcb/dqxnxq.do'];
    var list = [];
    for (var i = 0; i < urls.length; i++) {
      try {
        var data = await getJSON(urls[i]);
        var objs = collectObjects(data);
        for (var j = 0; j < objs.length; j++) {
          var code = semesterCode(objs[j]);
          if (!code) continue;
          if (!list.some(function (it) { return it.code === code; })) {
            list.push({
              code: code,
              label: String(val(objs[j], ['XNXQDM_DISPLAY', 'XNXQMC', 'xnxqmc']) || code)
            });
          }
        }
        if (list.length) break;
      } catch (e) {}
    }
    return list;
  }

  function courseRows(data) {
    var objs = collectObjects(data);
    return objs.filter(function (o) {
      return !!(val(o, ['KCM', 'kcm']) && (val(o, ['SKXQ', 'skxq']) || val(o, ['KSJC', 'ksjc'])));
    });
  }

  function expandWeeks(raw) {
    var s = String(raw || '').replace(/\s/g, '');
    var weeks = [];
    if (!/^[01]+$/.test(s)) return weeks;
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) === '1') {
        var w = i + 1;
        if (w >= 1 && w <= 30) weeks.push(w);
      }
    }
    return weeks;
  }

  function normalize(rows) {
    var list = [];
    for (var i = 0; i < rows.length; i++) {
      var o = rows[i];
      var name = String(val(o, ['KCM', 'kcm']) || '').trim();
      var day = Number(val(o, ['SKXQ', 'skxq']));
      var start = Number(val(o, ['KSJC', 'ksjc']));
      var end = Number(val(o, ['JSJC', 'jsjc']));
      var weeks = expandWeeks(val(o, ['SKZC', 'skzc']));
      if (!name || !(day >= 1 && day <= 7) || !(start >= 1) || !(end >= start) || !weeks.length) continue;
      list.push({
        name: name,
        teacher: String(val(o, ['SKJS', 'skjs']) || '').trim(),
        position: String(val(o, ['JASMC', 'jasmc']) || '').trim(),
        day: day,
        startSection: start,
        endSection: end,
        weeks: weeks
      });
    }
    return list;
  }

  function weeksKey(weeks) {
    return weeks.slice().sort(function (a, b) { return a - b; }).join(',');
  }

  function mergeCourses(list) {
    // 同一门课、同一周次、连续节次合并
    var groups = {};
    list.forEach(function (c) {
      var key = [c.name, c.teacher, c.position, c.day, weeksKey(c.weeks)].join('|');
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    var stage1 = [];
    Object.keys(groups).forEach(function (key) {
      var arr = groups[key].sort(function (a, b) { return a.startSection - b.startSection; });
      var cur = null;
      arr.forEach(function (c) {
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
      });
      if (cur) stage1.push(cur);
    });

    // 同一门课、同一天、同一节次，周次取并集
    var bySection = {};
    stage1.forEach(function (c) {
      var key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!bySection[key]) {
        bySection[key] = c;
      } else {
        var set = {};
        bySection[key].weeks.concat(c.weeks).forEach(function (w) { set[w] = 1; });
        bySection[key].weeks = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
      }
    });
    return Object.keys(bySection).map(function (k) { return bySection[k]; });
  }

  async function fetchCalendar(code) {
    var parts = code.split('-');
    if (parts.length !== 3) return null;
    var xn = parts[0] + '-' + parts[1];
    var xq = parts[2];
    try {
      var data = await getJSON(BASE + '/xskcb/cxxljc.do?XN=' + encodeURIComponent(xn) + '&XQ=' + encodeURIComponent(xq));
      var objs = collectObjects(data);
      for (var i = 0; i < objs.length; i++) {
        var start = val(objs[i], ['XQKSRQ', 'xqksrq']);
        var total = val(objs[i], ['ZZC', 'zzc']);
        if (start || total) {
          return {
            semesterStartDate: start ? String(start).slice(0, 10) : '',
            semesterTotalWeeks: total ? Number(total) : 0
          };
        }
      }
    } catch (e) {}
    return null;
  }

  function timeSlots() {
    return DEFAULT_SLOTS.map(function (it, idx) {
      return { section: idx + 1, startTime: it[0], endTime: it[1] };
    });
  }

  try {
    var semesters = await fetchSemesters();
    var selected = null;

    if (!semesters.length) {
      var probe = await getJSON(BASE + '/xskcb/xskcb.do');
      var probeRows = courseRows(probe);
      var codes = [];
      probeRows.forEach(function (o) {
        var c = String(val(o, ['XNXQDM', 'xnxqdm']) || '');
        if (/^\d{4}-\d{4}-[12]$/.test(c) && codes.indexOf(c) < 0) codes.push(c);
      });
      semesters = codes.map(function (c) { return { code: c, label: c }; });
    }

    if (!semesters.length) {
      fail('没有读到学期信息，请确认已登录教务系统并停留在课表页面');
    }

    if (semesters.length === 1) {
      selected = semesters[0];
    } else {
      var idx = await choose('选择学期', semesters.map(function (s) { return s.label; }), 0);
      if (idx === null || idx === undefined || idx < 0) {
        toast('已取消，未导入');
        return;
      }
      selected = semesters[idx] || semesters[0];
    }

    var data = await getJSON(BASE + '/xskcb/xskcb.do?XNXQDM=' + encodeURIComponent(selected.code));
    var rows = courseRows(data);
    if (!rows.length) {
      fail('课表里没有解析到任何课程记录，可能当前学期没有课或页面已失效');
    }

    var courses = mergeCourses(normalize(rows));
    if (!courses.length) {
      fail('课程字段不完整（缺少课程名、星期、节次或周次），无法导入');
    }

    var ok = await alertBox(
      '确认导入',
      '学期：' + selected.label + '\n课程：' + courses.length + ' 门\n作息：12 节\n\n是否导入到拾光？',
      '开始导入'
    );
    if (!ok) {
      toast('已取消，未导入');
      return;
    }

    if (!HAS_BP || typeof BP.saveImportedCourses !== 'function') {
      fail('当前页面没有可用的导入桥，请在拾光 App 内打开');
    }

    var saved = await BP.saveImportedCourses(JSON.stringify(courses));
    if (saved === false) fail('课程保存失败');

    var calendar = await fetchCalendar(selected.code);
    var cfg = {};
    if (calendar) {
      if (calendar.semesterStartDate) cfg.semesterStartDate = calendar.semesterStartDate;
      if (calendar.semesterTotalWeeks > 0) cfg.semesterTotalWeeks = calendar.semesterTotalWeeks;
    }

    var cfgOk = true;
    if (Object.keys(cfg).length) {
      try {
        if (typeof BP.saveCourseConfig === 'function') {
          await BP.saveCourseConfig(JSON.stringify(cfg));
        }
      } catch (e) {
        cfgOk = false;
      }
    }

    var slotsOk = true;
    try {
      if (typeof BP.savePresetTimeSlots === 'function') {
        await BP.savePresetTimeSlots(JSON.stringify(timeSlots()));
      }
    } catch (e) {
      slotsOk = false;
    }

    var msg = '已导入 ' + courses.length + ' 门课程';
    if (!cfgOk) msg += '；学期配置保存失败';
    if (!slotsOk) msg += '；作息保存失败';
    toast(msg);
    await alertBox('导入完成', msg, '好的');
  } catch (e) {
    var reason = (e && e.message) ? e.message : String(e);
    toast('导入失败：' + reason);
    try { await alertBox('导入失败', reason, '知道了'); } catch (_) {}
  } finally {
    try {
      if (BR && typeof BR.notifyTaskCompletion === 'function') BR.notifyTaskCompletion();
    } catch (_) {}
  }
})();
