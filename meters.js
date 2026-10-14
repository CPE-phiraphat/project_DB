/* ==========================================
 * meters.js - จดมิเตอร์น้ำ-ไฟ (v4.2)
 * ⭐ v4.2: ลบข้อความ "(สัญญาเหมาจ่าย)" ออกจาก label
 * ⭐ v4.1: Fix ห้องว่าง + ใช้ data-room เป็น key
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'https://n8n_mirot.minmark.xyz/webhook';

    const MONTH_NAMES_TH = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];

    const state = {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        filter: 'all',
        search: ''
    };

    let rates = { elec: 0, water: 0 };
    let meterData = [];
    let lastBuildingId = '';
    let isLoading = false;

    const showNotification = window.showNotification || ((msg) => alert(msg));
    const escapeHtml = window.escapeHtml || ((s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const formatNumber = window.formatNumber || ((n) => Number(n || 0).toLocaleString('en-US'));
    const toArray = window.toArray || ((v) => Array.isArray(v) ? v : (v ? [v] : []));
    const getCurrentBuildingId = window.getCurrentBuildingId || (() => '');
    const getCurrentBuildingName = window.getCurrentBuildingName || (() => '');

    // ==========================================
    // Helpers
    // ==========================================
    function getFloor(roomNumber) {
        const num = parseInt(String(roomNumber || '').replace(/\D/g, ''), 10);
        if (isNaN(num)) return 0;
        return Math.floor(num / 100);
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    function getReadingMonth() {
        return `${state.year}-${pad2(state.month)}`;
    }

    function _pickNum(obj, keys, fallback) {
        if (!obj) return fallback;
        for (const k of keys) {
            if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
                const n = parseFloat(obj[k]);
                if (!isNaN(n)) return n;
            }
        }
        return fallback;
    }

    function extractResult(raw) {
        if (!raw) return { success: false, message: 'Response ว่างเปล่า' };
        if (Array.isArray(raw)) {
            if (raw.length === 0) return { success: false, message: 'Array ว่าง' };
            const item = raw[0];
            if (item && item.json) {
                if (Array.isArray(item.json) && item.json.length > 0) return extractResult(item.json);
                return { success: item.json.success === true, message: item.json.message || '', data: item.json };
            }
            return { success: item?.success === true, message: item?.message || '', data: item };
        }
        if (typeof raw === 'object') {
            if (raw.json) return { success: raw.json.success === true, message: raw.json.message || '', data: raw.json };
            return { success: raw.success === true, message: raw.message || '', data: raw };
        }
        return { success: false, message: 'ไม่รู้จัก Response' };
    }

    // ==========================================
    // Draft (localStorage)
    // ==========================================
    function draftKey() {
        return `meter_draft_${getCurrentBuildingId()}_${getReadingMonth()}`;
    }

    function saveDraft() {
        try {
            const draft = {
                _rates: { elec: rates.elec, water: rates.water }
            };
            document.querySelectorAll('.js-meter-input').forEach(inp => {
                const rid = inp.getAttribute('data-room');
                if (!rid) return;
                const type = inp.getAttribute('data-type');
                if (!draft[rid]) draft[rid] = {};
                draft[rid][type] = inp.value;
            });
            document.querySelectorAll('.js-meter-note').forEach(inp => {
                const rid = inp.getAttribute('data-room');
                if (!rid) return;
                if (!draft[rid]) draft[rid] = {};
                draft[rid].note = inp.value;
            });
            localStorage.setItem(draftKey(), JSON.stringify(draft));
        } catch (e) { /* ignore */ }
    }

    function loadDraft() {
        try {
            const raw = localStorage.getItem(draftKey());
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    function clearDraft() {
        try { localStorage.removeItem(draftKey()); } catch { /* ignore */ }
    }

    function applyDraft() {
        const draft = loadDraft();
        if (!draft) return;

        if (draft._rates) {
            rates = { elec: draft._rates.elec || 0, water: draft._rates.water || 0 };
            const er = document.getElementById('elecRateInput');
            const wr = document.getElementById('waterRateInput');
            if (er) er.value = rates.elec;
            if (wr) wr.value = rates.water;
        }

        Object.keys(draft).forEach(rid => {
            if (rid === '_rates') return;
            const entry = draft[rid];
            Object.keys(entry).forEach(type => {
                const sel = type === 'note'
                    ? `input.js-meter-note[data-room="${rid}"]`
                    : `input[data-room="${rid}"][data-type="${type}"]`;
                const inp = document.querySelector(sel);
                if (inp) inp.value = entry[type];
            });
        });
    }

    // ==========================================
    // Month controls
    // ==========================================
    function setupMonthControls() {
        const yearSel = document.getElementById('yearSelect');
        const monthSel = document.getElementById('monthSelect');
        if (!yearSel || !monthSel) return;

        const nowY = new Date().getFullYear();
        yearSel.innerHTML = '';
        for (let y = nowY - 3; y <= nowY + 3; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            yearSel.appendChild(opt);
        }

        yearSel.value = state.year;
        monthSel.value = state.month;

        yearSel.addEventListener('change', () => {
            state.year = parseInt(yearSel.value, 10);
            updateMonthLabel();
            loadMeterReadings();
        });
        monthSel.addEventListener('change', () => {
            state.month = parseInt(monthSel.value, 10);
            updateMonthLabel();
            loadMeterReadings();
        });
    }

    function updateMonthLabel() {
        const el = document.getElementById('currentMonthLabel');
        if (el) el.innerText = `${MONTH_NAMES_TH[state.month - 1]} ${state.year}`;
        const ys = document.getElementById('yearSelect');
        const ms = document.getElementById('monthSelect');
        if (ys) ys.value = state.year;
        if (ms) ms.value = state.month;
    }

    function prevMonth() {
        state.month -= 1;
        if (state.month < 1) { state.month = 12; state.year -= 1; }
        updateMonthLabel();
        loadMeterReadings();
    }

    function nextMonth() {
        state.month += 1;
        if (state.month > 12) { state.month = 1; state.year += 1; }
        updateMonthLabel();
        loadMeterReadings();
    }

    // ==========================================
    // 1. โหลดข้อมูลมิเตอร์
    // ==========================================
    async function loadMeterReadings() {
        if (isLoading) return;

        const buildingId = getCurrentBuildingId();
        const readingMonth = getReadingMonth();

        if (!buildingId) {
            showNotification('⚠️ กรุณาเลือกอาคาร', 'error');
            return;
        }

        const listEl = document.getElementById('meterRoomList');
        listEl.innerHTML = '<p class="text-center text-gray-400 py-8">⏳ กำลังโหลด...</p>';
        document.getElementById('meterActionBar').classList.add('hidden');
        document.getElementById('meterProgressWrap').classList.add('hidden');
        document.getElementById('meterFilters').classList.add('hidden');

        isLoading = true;
        try {
            const url = `${API_BASE}/meters-preview?building_id=${buildingId}&reading_month=${readingMonth}&_t=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store' });
            const data = await res.json();

            let rooms = data;
            if (!Array.isArray(rooms)) {
                if (rooms && typeof rooms === 'object' && Array.isArray(rooms.data)) rooms = rooms.data;
                else if (rooms && typeof rooms === 'object' && Object.keys(rooms).length > 0) rooms = [rooms];
                else rooms = [];
            }

            const rawCount = rooms.length;
            const currentBid = Number(buildingId);
            meterData = rooms.filter(r => {
                if (r.building_id !== undefined && r.building_id !== null) {
                    return Number(r.building_id) === currentBid;
                }
                return true;
            });

            if (meterData.length !== rawCount) {
                console.warn(`🛡 กรองออก ${rawCount - meterData.length} ห้อง ที่ไม่ใช่อาคาร ${currentBid}`);
            }

            console.log(`📦 โหลดมิเตอร์ ${meterData.length} ห้อง (อาคาร ${buildingId}, ${readingMonth})`);

            const firstRoom = meterData[0] || {};
            const elecRateFromAPI = _pickNum(data, ['elec_rate', 'elec_unit_price'], null)
                                 ?? _pickNum(firstRoom, ['elec_rate', 'elec_unit_price'], 0);
            const waterRateFromAPI = _pickNum(data, ['water_rate', 'water_unit_price'], null)
                                  ?? _pickNum(firstRoom, ['water_rate', 'water_unit_price'], 0);

            rates = { elec: elecRateFromAPI || 0, water: waterRateFromAPI || 0 };
            const er = document.getElementById('elecRateInput');
            const wr = document.getElementById('waterRateInput');
            if (er) er.value = rates.elec;
            if (wr) wr.value = rates.water;

            renderMeterList();
            applyDraft();
            updateSummary();
        } catch (err) {
            console.error('❌ โหลดล้มเหลว:', err);
            listEl.innerHTML = `<p class="text-center text-red-500 py-8">❌ ${escapeHtml(err.message)}</p>`;
        } finally {
            isLoading = false;
        }
    }

    // ==========================================
    // 2. Filter + Search
    // ==========================================
    function getFilteredData() {
        const q = state.search.trim().toLowerCase();
        return meterData.filter(item => {
            const hasReading = checkHasReading(item);
            if (state.filter === 'pending' && hasReading) return false;
            if (state.filter === 'done' && !hasReading) return false;
            if (q) {
                const room = String(item.room_number || '').toLowerCase();
                const tenant = String(item.tenant_name || '').toLowerCase();
                if (!room.includes(q) && !tenant.includes(q)) return false;
            }
            return true;
        });
    }

    function checkHasReading(item) {
        const rid = item.room_id;
        if (!rid) return item.has_reading === true;

        const prevElec = parseFloat(item.prev_elec) || 0;
        const prevWater = parseFloat(item.prev_water) || 0;
        const currElecInp = document.querySelector(`input[data-room="${rid}"][data-type="curr_elec"]`);
        const currWaterInp = document.querySelector(`input[data-room="${rid}"][data-type="curr_water"]`);
        const currElec = currElecInp ? (parseFloat(currElecInp.value) || 0) : (parseFloat(item.curr_elec) || 0);
        const currWater = currWaterInp ? (parseFloat(currWaterInp.value) || 0) : (parseFloat(item.curr_water) || 0);

        const elecOK = currElec > prevElec;
        const waterOK = currWater > prevWater;
        return elecOK && waterOK;
    }

    function setupFilters() {
        document.querySelectorAll('.js-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                state.filter = btn.getAttribute('data-filter');
                document.querySelectorAll('.js-filter-btn').forEach(b => {
                    b.classList.remove('filter-btn-active');
                    b.classList.add('text-gray-600');
                });
                btn.classList.add('filter-btn-active');
                btn.classList.remove('text-gray-600');
                renderMeterList();
            });
        });

        const search = document.getElementById('searchRoom');
        if (search) {
            search.addEventListener('input', () => {
                clearTimeout(window._meterSearchTimer);
                window._meterSearchTimer = setTimeout(() => {
                    state.search = search.value;
                    renderMeterList();
                }, 200);
            });
        }

        const allBtn = document.querySelector('.js-filter-btn[data-filter="all"]');
        if (allBtn) {
            allBtn.classList.add('filter-btn-active');
            allBtn.classList.remove('text-gray-600');
        }
    }

    // ==========================================
    // 3. Render
    // ==========================================
    function renderMeterList() {
        const listEl = document.getElementById('meterRoomList');
        const actionBar = document.getElementById('meterActionBar');
        const progressWrap = document.getElementById('meterProgressWrap');
        const filtersBar = document.getElementById('meterFilters');

        if (meterData.length === 0) {
            listEl.innerHTML = '<p class="text-center text-gray-400 py-8">ไม่พบห้องในอาคารนี้</p>';
            actionBar.classList.add('hidden');
            progressWrap.classList.add('hidden');
            filtersBar.classList.add('hidden');
            return;
        }

        progressWrap.classList.remove('hidden');
        filtersBar.classList.remove('hidden');

        const filtered = getFilteredData();

        if (filtered.length === 0) {
            listEl.innerHTML = `<p class="text-center text-gray-400 py-8">
                ${state.filter !== 'all' || state.search ? 'ไม่พบห้องที่ตรงกับเงื่อนไข' : 'ไม่มีข้อมูล'}
            </p>`;
            actionBar.classList.remove('hidden');
            updateProgress();
            return;
        }

        const grouped = {};
        filtered.forEach(item => {
            const floor = getFloor(item.room_number);
            if (!grouped[floor]) grouped[floor] = [];
            grouped[floor].push(item);
        });

        const floors = Object.keys(grouped).map(Number).sort((a, b) => a - b);

        let html = '';
        floors.forEach(floor => {
            html += `
                <div class="border border-gray-200 rounded-lg overflow-hidden">
                    <div class="bg-gradient-to-r from-blue-50 to-blue-100 px-4 py-2 border-b border-gray-200">
                        <span class="font-bold text-blue-800">ชั้น ${floor}</span>
                        <span class="text-xs text-gray-600 ml-2">(${grouped[floor].length} ห้อง)</span>
                    </div>
                    <div class="divide-y divide-gray-100">
            `;
            grouped[floor].forEach(item => { html += renderRoomItem(item); });
            html += `</div></div>`;
        });

        listEl.innerHTML = html;
        actionBar.classList.remove('hidden');

        document.querySelectorAll('.js-meter-input').forEach(inp => {
            inp.addEventListener('input', onMeterInput);
            inp.addEventListener('blur', saveDraft);
        });
        document.querySelectorAll('.js-meter-note').forEach(inp => {
            inp.addEventListener('input', saveDraft);
        });

        const er = document.getElementById('elecRateInput');
        const wr = document.getElementById('waterRateInput');
        if (er && !er._bound) {
            er._bound = true;
            er.addEventListener('input', () => { rates.elec = parseFloat(er.value) || 0; saveDraft(); });
        }
        if (wr && !wr._bound) {
            wr._bound = true;
            wr.addEventListener('input', () => { rates.water = parseFloat(wr.value) || 0; saveDraft(); });
        }

        updateProgress();
        updateSummary();
    }

    function renderRoomItem(item) {
        const isFlatElec = String(item.elec_charge_type || '').toUpperCase() === 'FLAT_RATE';
        const isFlatWater = String(item.water_charge_type || '').toUpperCase() === 'FLAT_RATE';
        const hasReading = item.has_reading === true;
        const hasTenant = item.has_tenant === true;

        const prevElec = parseFloat(item.prev_elec) || 0;
        const prevWater = parseFloat(item.prev_water) || 0;
        const currElec = item.has_reading ? item.curr_elec : '';
        const currWater = item.has_reading ? item.curr_water : '';

        const usedElec = Math.max((parseFloat(currElec) || 0) - prevElec, 0);
        const usedWater = Math.max((parseFloat(currWater) || 0) - prevWater, 0);

        const rid = item.room_id;

        return `
            <div class="p-4 hover:bg-gray-50/50 transition" data-room-row="${rid}">
                <div class="flex items-center gap-2 mb-3 flex-wrap">
                    <span class="font-bold text-blue-600 text-base">ห้อง ${escapeHtml(item.room_number)}</span>
                    ${hasTenant 
                        ? `<span class="text-sm text-gray-700">${escapeHtml(item.tenant_name || '-')}</span>`
                        : '<span class="text-sm text-gray-400 italic">— ห้องว่าง —</span>'}
                    ${isFlatElec ? '<span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">⚡ เหมาจ่าย</span>' : ''}
                    ${isFlatWater ? '<span class="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">💧 เหมาจ่าย</span>' : ''}
                    ${hasReading
                        ? '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ บันทึกแล้ว</span>'
                        : (!hasTenant 
                            ? '<span class="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">🚪 ว่าง</span>'
                            : '<span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">⏳ ยังไม่จด</span>')}
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <div class="flex items-center gap-2 mb-2">
                            <label class="block text-xs font-medium text-gray-600">⚡ ไฟฟ้า</label>
                        </div>
                        <div class="grid grid-cols-3 gap-2 items-end">
                            <div>
                                <p class="text-xs text-gray-500 mb-1">ก่อน</p>
                                <input type="number" step="0.01" readonly
                                       value="${prevElec}"
                                       class="w-full px-2 py-2 border border-gray-200 rounded text-sm bg-gray-100 text-gray-600 text-center"
                                       data-room="${rid}" data-type="prev_elec" tabindex="-1">
                            </div>
                            <div>
                                <p class="text-xs text-gray-500 mb-1">หลัง</p>
                                <input type="number" step="0.01" inputmode="decimal"
                                       value="${currElec}"
                                       class="js-meter-input w-full px-2 py-2 border-2 border-blue-300 rounded text-base focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-700 text-center"
                                       data-room="${rid}" data-type="curr_elec">
                            </div>
                            <div>
                                <p class="text-xs text-gray-500 mb-1">ใช้ไป</p>
                                <div class="w-full px-2 py-2 border border-gray-200 rounded text-sm bg-green-50 text-green-700 font-bold text-center"
                                     data-used="elec" data-room="${rid}">
                                    ${formatNumber(usedElec)}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <div class="flex items-center gap-2 mb-2">
                            <label class="block text-xs font-medium text-gray-600">💧 น้ำ</label>
                        </div>
                        <div class="grid grid-cols-3 gap-2 items-end">
                            <div>
                                <p class="text-xs text-gray-500 mb-1">ก่อน</p>
                                <input type="number" step="0.01" readonly
                                       value="${prevWater}"
                                       class="w-full px-2 py-2 border border-gray-200 rounded text-sm bg-gray-100 text-gray-600 text-center"
                                       data-room="${rid}" data-type="prev_water" tabindex="-1">
                            </div>
                            <div>
                                <p class="text-xs text-gray-500 mb-1">หลัง</p>
                                <input type="number" step="0.01" inputmode="decimal"
                                       value="${currWater}"
                                       class="js-meter-input w-full px-2 py-2 border-2 border-blue-300 rounded text-base focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-700 text-center"
                                       data-room="${rid}" data-type="curr_water">
                            </div>
                            <div>
                                <p class="text-xs text-gray-500 mb-1">ใช้ไป</p>
                                <div class="w-full px-2 py-2 border border-gray-200 rounded text-sm bg-green-50 text-green-700 font-bold text-center"
                                     data-used="water" data-room="${rid}">
                                    ${formatNumber(usedWater)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="mt-3">
                    <input type="text" placeholder="หมายเหตุ (ไม่บังคับ)"
                           value="${escapeHtml(item.reading_note || '')}"
                           class="js-meter-note w-full px-3 py-1.5 border border-gray-200 rounded text-xs outline-none focus:border-blue-500"
                           data-room="${rid}">
                </div>
            </div>
        `;
    }

    // ==========================================
    // 4. Input validation + live update
    // ==========================================
    function onMeterInput(e) {
        const inp = e.target;
        const rid = inp.getAttribute('data-room');
        const type = inp.getAttribute('data-type');

        const prevKey = type.endsWith('elec') ? 'prev_elec' : 'prev_water';
        const prevEl = document.querySelector(`input[data-room="${rid}"][data-type="${prevKey}"]`);
        const prevVal = parseFloat(prevEl?.value) || 0;
        const currVal = parseFloat(inp.value) || 0;

        if (currVal < prevVal && currVal > 0) {
            inp.classList.add('meter-input-error');
            inp.title = `⚠️ เลขหลังต้องมากกว่าหรือเท่ากับเลขก่อน (${prevVal})`;
        } else {
            inp.classList.remove('meter-input-error');
            inp.removeAttribute('title');
        }

        const usedType = type.endsWith('elec') ? 'elec' : 'water';
        const usedEl = document.querySelector(`[data-used="${usedType}"][data-room="${rid}"]`);
        if (usedEl) {
            usedEl.innerText = formatNumber(Math.max(currVal - prevVal, 0));
            if (currVal < prevVal && currVal > 0) {
                usedEl.classList.add('bg-red-50', 'text-red-600');
                usedEl.classList.remove('bg-green-50', 'text-green-700');
            } else {
                usedEl.classList.remove('bg-red-50', 'text-red-600');
                usedEl.classList.add('bg-green-50', 'text-green-700');
            }
        }

        updateProgress();
        updateSummary();

        clearTimeout(window._meterDraftTimer);
        window._meterDraftTimer = setTimeout(saveDraft, 800);
    }

    // ==========================================
    // 5. Progress + Summary
    // ==========================================
    function updateProgress() {
        const total = meterData.length;
        let done = 0;
        meterData.forEach(item => {
            if (checkHasReading(item)) done++;
        });

        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const bar = document.getElementById('progressBar');
        const txt = document.getElementById('progressText');
        if (bar) bar.style.width = pct + '%';
        if (txt) txt.innerText = `${done}/${total} ห้อง (${pct}%)`;
    }

    function updateSummary() {
        const total = meterData.length;
        const done = meterData.filter(item => checkHasReading(item)).length;
        const el = document.getElementById('meterSummary');
        if (el) el.innerText = `${done}/${total} ห้อง (จดแล้ว/ทั้งหมด)`;
    }

    // ==========================================
    // 6. Save all meters
    // ==========================================
    async function saveAllMeters() {
        const buildingId = getCurrentBuildingId();
        const readingMonth = getReadingMonth();
        const btn = document.getElementById('saveMetersBtn');
        const btnText = document.getElementById('saveMetersBtnText');

        if (!readingMonth) return showNotification('⚠️ กรุณาเลือกเดือน', 'error');
        if (meterData.length === 0) return showNotification('⚠️ ยังไม่มีข้อมูล', 'error');

        const elecRate = parseFloat(document.getElementById('elecRateInput')?.value) || 0;
        const waterRate = parseFloat(document.getElementById('waterRateInput')?.value) || 0;

        const readings = [];
        const errors = [];

        meterData.forEach(item => {
            const rid = item.room_id;
            if (!rid) return;

            const prevElec = parseFloat(document.querySelector(`input[data-room="${rid}"][data-type="prev_elec"]`)?.value) || 0;
            const prevWater = parseFloat(document.querySelector(`input[data-room="${rid}"][data-type="prev_water"]`)?.value) || 0;
            const currElecInp = document.querySelector(`input[data-room="${rid}"][data-type="curr_elec"]`);
            const currWaterInp = document.querySelector(`input[data-room="${rid}"][data-type="curr_water"]`);
            const noteInp = document.querySelector(`input.js-meter-note[data-room="${rid}"]`);

            const currElec = parseFloat(currElecInp?.value) || 0;
            const currWater = parseFloat(currWaterInp?.value) || 0;

            if (currElec > 0 && currElec < prevElec) {
                errors.push(`ห้อง ${item.room_number}: เลขไฟฟ้าหลัง (${currElec}) < ก่อน (${prevElec})`);
            }
            if (currWater > 0 && currWater < prevWater) {
                errors.push(`ห้อง ${item.room_number}: เลขน้ำหลัง (${currWater}) < ก่อน (${prevWater})`);
            }

            readings.push({
                contract_id: item.contract_id ? parseInt(item.contract_id) : null,
                room_id: parseInt(rid),
                elec_prev: prevElec,
                elec_curr: currElec,
                water_prev: prevWater,
                water_curr: currWater,
                note: noteInp?.value || null
            });
        });

        if (errors.length > 0) {
            alert('❌ พบข้อผิดพลาด:\n\n' + errors.slice(0, 10).join('\n') + (errors.length > 10 ? `\n...และอีก ${errors.length - 10} รายการ` : ''));
            return;
        }

        if (!confirm(`📊 ยืนยันบันทึกมิเตอร์ ${readings.length} ห้อง?\n\nเดือน: ${MONTH_NAMES_TH[state.month - 1]} ${state.year}\n⚡ ราคาไฟ: ${elecRate} ฿/หน่วย\n💧 ราคาน้ำ: ${waterRate} ฿/หน่วย`)) return;

        btn.disabled = true;
        btnText.innerText = 'กำลังบันทึก...';

        try {
            const processedBy = localStorage.getItem('admin_username') || 'admin';
            const payload = {
                building_id: parseInt(buildingId),
                reading_month: readingMonth,
                elec_rate: elecRate,
                water_rate: waterRate,
                readings: readings,
                created_by: processedBy
            };

            console.log('📤 Payload:', payload);

            const res = await fetch(`${API_BASE}/meters-save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const text = await res.text();
            let raw = null;
            try { raw = text ? JSON.parse(text) : null; } catch(_) {}
            const result = extractResult(raw);

            if (res.ok && result.success === true) {
                const data = result.data || {};
                showNotification(`✅ บันทึก ${data.saved_count || readings.length} ห้องสำเร็จ`, 'success');
                clearDraft();
                setTimeout(() => loadMeterReadings(), 800);
            } else {
                throw new Error(result.message || `HTTP ${res.status}`);
            }
        } catch (err) {
            console.error('❌ บันทึกล้มเหลว:', err);
            showNotification('❌ ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btnText.innerText = '✅ บันทึกทั้งหมด';
        }
    }

    // ==========================================
    // 7. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 meters.js v4.2 เริ่มทำงาน');

        const now = new Date();
        state.year = now.getFullYear();
        state.month = now.getMonth() + 1;

        setupMonthControls();
        updateMonthLabel();
        setupFilters();

        window.loadMeterReadings = loadMeterReadings;
        window.saveAllMeters = saveAllMeters;
        window.prevMonth = prevMonth;
        window.nextMonth = nextMonth;

        window.addEventListener('buildingChanged', () => {
            console.log('🔄 เปลี่ยนอาคาร → โหลดข้อมูลใหม่');
            loadMeterReadings();
        });

        lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const cur = getCurrentBuildingId();
            if (cur !== lastBuildingId) {
                lastBuildingId = cur;
                loadMeterReadings();
            }
        }, 1000);

        setTimeout(() => loadMeterReadings(), 500);

        console.log('✅ meters.js v4.2 โหลดสำเร็จ');
    });

})();
