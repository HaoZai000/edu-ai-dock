// 中山火炬职业技术学院 · 正方教务
// 学期及校历接口参考 GZMTU（weiwei221206）、UJS（洛初，基于 GSMC）。
// 贡献来源保留在拾光仓库对应脚本和提交历史中，许可遵循仓库 MIT 声明。
(async () => {
    const bridge = window.shiguangBridgePromise;
    const ui = window.shiguangBridge;
    const origin = 'http://119.145.248.32:84';
    const entry = '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151';
    const schedule = '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
    const calendar = '/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154';
    const periods = '/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

    async function request(path, label, params) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`${origin}/jwglxt${path}`, {
                method: params ? 'POST' : 'GET',
                credentials: 'same-origin',
                headers: params ? { 'X-Requested-With': 'XMLHttpRequest' } : undefined,
                body: params ? new URLSearchParams(params) : undefined,
                signal: controller.signal,
            });
            if (new URL(response.url).pathname === '/jwglxt/xtgl/login_slogin.html') {
                throw new Error('请先登录新版教务系统，再开始导入。');
            }
            if (!response.ok) throw new Error(`读取${label}失败（HTTP ${response.status}）。`);
            if (!params) return await response.text();
            try {
                return await response.json();
            } catch (error) {
                if (error.name !== 'SyntaxError') throw error;
                throw new Error(`教务返回的${label}格式有误，请确认当前登录状态。`);
            }
        } catch (error) {
            if (controller.signal.aborted) throw new Error(`读取${label}超时，请检查教务网络。`);
            if (error.name === 'TypeError') throw new Error(`无法连接教务以读取${label}。`);
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    async function selectOption(page, selector, title, formatLabel) {
        const options = [];
        let selectedIndex = -1;
        // 正方页面会覆盖 Array.prototype.filter/some/every。
        for (const option of page.querySelectorAll(`${selector} option`)) {
            if (!option.value) continue;
            if (option.selected) selectedIndex = options.length;
            options.push({ value: option.value, label: formatLabel(option.textContent.trim()) });
        }
        if (!options.length) throw new Error('教务未返回学期选项，请登录后重试。');
        const index = await bridge.showSingleSelection(
            title, JSON.stringify(options.map(option => option.label)), selectedIndex
        );
        return options[index]?.value ?? null;
    }

    function readCalendar(rows) {
        if (!Array.isArray(rows) || !rows.length) throw new Error('所选学期未提供校历。');
        let startDate;
        let totalWeeks = 0;
        for (const row of rows) {
            const week = Number(row.zs);
            if (!Number.isInteger(week) || week < 1 || week > 60) {
                throw new Error('教务校历中的周次有误。');
            }
            if (week === 1) startDate = String(row.rq ?? '').split('/')[0];
            totalWeeks = Math.max(totalWeeks, week);
        }
        const date = new Date(`${startDate}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(date.getTime()) ||
            date.toISOString().slice(0, 10) !== startDate) {
            throw new Error('所选学期校历缺少有效的第 1 周起始日期。');
        }
        return { semesterStartDate: startDate, semesterTotalWeeks: totalWeeks };
    }

    function readPeriods(rows) {
        if (!Array.isArray(rows) || !rows.length) throw new Error('所选学期未提供节次作息。');
        const slots = rows.map(row => ({
            number: Number(row.jcmc), startTime: String(row.qssj ?? ''), endTime: String(row.jssj ?? ''),
        })).sort((a, b) => a.number - b.number);
        const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
        for (let i = 0; i < slots.length; i++) {
            const { number, startTime, endTime } = slots[i];
            if (number !== i + 1 || !clock.test(startTime) || !clock.test(endTime) || startTime >= endTime ||
                (i > 0 && startTime < slots[i - 1].endTime)) {
                throw new Error('教务返回的节次作息编号或时间有误。');
            }
        }
        return slots;
    }

    function readWeeks(value, totalWeeks) {
        const weeks = new Set();
        const text = String(value ?? '').replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
        for (const part of text.split(/[,，]/)) {
            const match = part.match(/^(?:第)?(\d+)(?:[-–至](\d+))?周?(?:\(([单双])周?\))?$/);
            if (!match) throw new Error('教务返回了无法识别的课程周次。');
            const start = Number(match[1]);
            const end = Number(match[2] ?? start);
            if (start < 1 || start > end || end > totalWeeks) throw new Error('课程周次超出所选学期校历。');
            for (let week = start; week <= end; week++) {
                if (match[3] === '单' && week % 2 === 0 || match[3] === '双' && week % 2 === 1) continue;
                weeks.add(week);
            }
        }
        if (!weeks.size) throw new Error('教务返回了空的课程周次。');
        return weeks;
    }

    function readCourses(rows, config, slotsByCampus, baseSlots) {
        const grouped = new Map();
        for (const row of rows) {
            const name = String(row.kcmc ?? '').trim();
            const teacher = String(row.xm ?? '').trim();
            const position = String(row.cdmc ?? '').trim();
            const day = Number(row.xqj);
            // jcor 是页面的合并显示范围，jcs 才是这条记录实际占用的节次。
            const section = String(row.jcs ?? '').match(/^(\d+)(?:-(\d+))?$/);
            const startSection = Number(section?.[1]);
            const endSection = Number(section?.[2] ?? startSection);
            const slots = slotsByCampus.get(String(row.xqh_id ?? ''));
            if (!name || !Number.isInteger(day) || day < 1 || day > 7 || !section ||
                startSection < 1 || startSection > endSection || endSection > slots.length) {
                throw new Error('教务返回的课程缺少有效的星期或节次。');
            }
            const startTime = slots[startSection - 1].startTime;
            const endTime = slots[endSection - 1].endTime;
            const groupKey = JSON.stringify([row.kch_id, name, teacher, position, day, startSection, endSection, startTime, endTime]);
            if (!grouped.has(groupKey)) {
                const course = { name, teacher, position, day, startSection, endSection, weeks: new Set() };
                if (startTime !== baseSlots[startSection - 1]?.startTime || endTime !== baseSlots[endSection - 1]?.endTime) {
                    Object.assign(course, { isCustomTime: true, customStartTime: startTime, customEndTime: endTime });
                }
                const credit = Number(row.xf);
                if (row.xf != null && row.xf !== '' && Number.isFinite(credit) && credit >= 0) course.credit = credit;
                grouped.set(groupKey, course);
            }
            const course = grouped.get(groupKey);
            for (const week of readWeeks(row.zcd, config.semesterTotalWeeks)) course.weeks.add(week);
        }
        return Array.from(grouped.values(), course => ({ ...course, weeks: [...course.weeks].sort((a, b) => a - b) }));
    }

    try {
        if (window.location.origin !== origin) throw new Error('请打开中山火炬职业技术学院新版教务并登录。');
        const html = await request(entry, '学期列表');
        const page = new DOMParser().parseFromString(html, 'text/html');
        const xnm = await selectOption(page, '#xnm', '选择学年', label => label);
        if (xnm === null) return;
        const xqm = await selectOption(page, '#xqm', '选择学期', label => /^\d+$/.test(label) ? `第 ${label} 学期` : label);
        if (xqm === null) return;

        const term = { xnm, xqm };
        const data = await request(schedule, '课表', { ...term, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' });
        if (data?.xnxqsfkz === true || data?.xnxqsfkz === 'true') throw new Error('教务尚未开放所选学期的课表。');
        if (!Array.isArray(data?.kbList)) throw new Error('教务未返回所选学期的课表。');
        const practicalCount = Array.isArray(data.sjkList) ? data.sjkList.length : 0;
        if (!data.kbList.length) {
            throw new Error(practicalCount ? `所选学期只有 ${practicalCount} 条未安排固定节次的集中实践。` : '所选学期没有课程。');
        }
        const campuses = new Set();
        for (const row of data.kbList) {
            if (String(row.xnm) !== xnm || String(row.xqm) !== xqm) throw new Error('教务返回的课表与所选学期不符。');
            campuses.add(String(row.xqh_id ?? ''));
        }
        const [calendarRows, campusPeriods] = await Promise.all([
            request(calendar, '校历', term),
            Promise.all(Array.from(campuses, async campus => [
                campus, readPeriods(await request(periods, '节次作息', { ...term, xqh_id: campus })),
            ])),
        ]);
        const config = readCalendar(calendarRows);
        const slotsByCampus = new Map(campusPeriods);
        const baseSlots = campusPeriods[0][1];
        const courses = readCourses(data.kbList, config, slotsByCampus, baseSlots);

        if (await bridge.saveCourseConfig(JSON.stringify(config)) !== true ||
            await bridge.savePresetTimeSlots(JSON.stringify(baseSlots)) !== true ||
            await bridge.saveImportedCourses(JSON.stringify(courses)) !== true) {
            throw new Error('课表导入未完成。');
        }
        if (practicalCount) ui.showToast(`${practicalCount} 条集中实践仅标注周次，未排入课表。`);
        ui.notifyTaskCompletion();
    } catch (error) {
        ui.showToast(error instanceof Error ? error.message : '教务课表导入失败。');
    }
})();
