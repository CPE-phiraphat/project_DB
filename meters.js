/* ==========================================
 * meters.js - จดมิเตอร์น้ำ-ไฟ (v1)
 * ⭐ แยกหน้าจดมิเตอร์ออกจากหน้าออกบิล
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'https://n8n_mirot.minmark.xyz/webhook';

    let meterData = [];
    let lastBuildingId = '';

    const showNotification = window.showNotification;
    const escapeHtml = window.escapeHtml;
    const formatNumber = window.formatNumber;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

    function normalizeStatus(s) {
        return String(s || '').trim().toUpperCase();
    }

    function getFloor(roomNumber) {
        const num = parseInt(String(roomNumber || '').replace(/\D/g, ''), 10);
        if (isNaN(num)) return 0;
        return Math.floor(num / 100);
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
    // 1. โหลดข้อมูลมิเตอร์
    // ==========================================
    async function loadMeterReadings() {
        const buildingId = getCurrentBuildingId();
        const readingMonth = document.getElementById('readingMonth').value;

        if (!buildingId) {
            showNotification('⚠️ กรุณาเลือกอาคาร', 'error');
            return;
        }
        if (!readingMonth) {
            showNotification('⚠️ กรุณาเลือกเดือน', 'error');
            return;
        }

        const listEl = document.getElementById('meterRoomList');
        listEl.innerHTML = '<p class="text-center text-gray-400 py-8">⏳ กำลังโหลด...</p>';
        document.getElementById('meterActionBar').classList.add('hidden');

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

            meterData = rooms;
            console.log('📦 โหลดมิเตอร์:', meterData.length, 'ห้อง');

            renderMeterList();
        } catch (err) {
            console.error('❌ โหลดล้มเหลว:', err);
            listEl.innerHTML = `<p class="text-center text-red-500 py-8">❌ ${err.message}</p>`;
        }
    }

    // ==========================================
    // 2. Render
    // ==========================================
    function renderMeterList() {
        const listEl = document.getElementById('meterRoomList');
        const actionBar = document.getElementById('meterActionBar');

        if (meterData.length === 0) {
            listEl.innerHTML = '<p class="text-center text-gray-400 py-8">ไม่พบห้องที่มีสัญญา ACTIVE</p>';
            actionBar.classList.add('hidden');
            return;
        }

        // Group by floor
        const grouped = {};
        meterData.forEach(item => {
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

            grouped[floor].forEach(item => {
                const isFlatElec = String(item.elec_charge_type || '').toUpperCase() === 'FLAT_RATE';
                const isFlatWater = String(item.water_charge_type || '').toUpperCase() === 'FLAT_RATE';
                const hasReading = item.has_reading === true;
                const readingId = item.reading_id || '';

                html += `
                    <div class="p-4 hover:bg-gray-50 transition">
                        <div class="flex items-center gap-3 mb-3 flex-wrap">
                            <span class="font-bold text-blue-600 text-base">ห้อง ${escapeHtml(item.room_number)}</span>
                            <span class="text-sm text-gray-700">${escapeHtml(item.tenant_name || '-')}</span>
                            ${isFlatElec ? '<span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">⚡ เหมาจ่าย</span>' : ''}
                            ${isFlatWater ? '<span class="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">💧 เหมาจ่าย</span>' : ''}
                            ${hasReading ? '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ บันทึกแล้ว</span>' : '<span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">⏳ ยังไม่จด</span>'}
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                            <!-- ไฟฟ้า -->
                            <div class="${isFlatElec ? 'opacity-50' : ''}">
                                <div class="flex items-center gap-2 mb-2">
                                    <label class="block text-xs font-medium text-gray-600">⚡ ไฟฟ้า</label>
                                    ${isFlatElec ? `<span class="text-xs text-yellow-700">(เหมาจ่าย ${formatNumber(item.elec_flat_rate)} ฿)</span>` : ''}
                                </div>
                                <div class="grid grid-cols-2 gap-2">
                                    <div>
                                        <p class="text-xs text-gray-500 mb-1">ก่อน</p>
                                        <input type="number" step="0.01" readonly
                                               value="${item.prev_elec}"
                                               class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-gray-100 text-gray-600"
                                               data-contract="${item.contract_id}" data-type="prev_elec">
                                    </div>
                                    <div>
                                        <p class="text-xs text-gray-500 mb-1">หลัง</p>
                                        <input type="number" step="0.01" ${isFlatElec ? 'disabled' : ''}
                                               value="${item.curr_elec || item.prev_elec}"
                                               class="js-meter-input w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-700"
                                               data-contract="${item.contract_id}" data-type="curr_elec">
                                    </div>
                                </div>
                            </div>

                            <!-- น้ำ -->
                            <div class="${isFlatWater ? 'opacity-50' : ''}">
                                <div class="flex items-center gap-2 mb-2">
                                    <label class="block text-xs font-medium text-gray-600">💧 น้ำ</label>
                                    ${isFlatWater ? `<span class="text-xs text-blue-700">(เหมาจ่าย ${formatNumber(item.water_flat_rate)} ฿)</span>` : ''}
                                </div>
                                <div class="grid grid-cols-2 gap-2">
                                    <div>
                                        <p class="text-xs text-gray-500 mb-1">ก่อน</p>
                                        <input type="number" step="0.01" readonly
                                               value="${item.prev_water}"
                                               class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-gray-100 text-gray-600"
                                               data-contract="${item.contract_id}" data-type="prev_water">
                                    </div>
                                    <div>
                                        <p class="text-xs text-gray-500 mb-1">หลัง</p>
                                        <input type="number" step="0.01" ${isFlatWater ? 'disabled' : ''}
                                               value="${item.curr_water || item.prev_water}"
                                               class="js-meter-input w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-700"
                                               data-contract="${item.contract_id}" data-type="curr_water">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="mt-3">
                            <input type="text" placeholder="หมายเหตุ (ไม่บังคับ)"
                                   value="${escapeHtml(item.reading_note || '')}"
                                   class="js-meter-note w-full px-3 py-1.5 border border-gray-200 rounded text-xs outline-none focus:border-blue-500"
                                   data-contract="${item.contract_id}">
                        </div>
                    </div>
                `;
            });

            html += `</div></div>`;
        });

        listEl.innerHTML = html;
        actionBar.classList.remove('hidden');

        // Update summary
        updateSummary();
        document.querySelectorAll('.js-meter-input').forEach(inp => {
            inp.addEventListener('input', updateSummary);
        });
    }

    // ==========================================
    // 3. Summary
    // ==========================================
    function updateSummary() {
        const totalRooms = meterData.length;
        const filled = meterData.filter(item => item.has_reading).length;
        const el = document.getElementById('meterSummary');
        if (el) el.innerText = `${filled}/${totalRooms} ห้อง (จดแล้ว/ทั้งหมด)`;
    }

    // ==========================================
    // 4. Save all meters
    // ==========================================
    async function saveAllMeters() {
        const buildingId = getCurrentBuildingId();
        const readingMonth = document.getElementById('readingMonth').value;
        const btn = document.getElementById('saveMetersBtn');
        const btnText = document.getElementById('saveMetersBtnText');

        if (!readingMonth) return showNotification('⚠️ กรุณาเลือกเดือน', 'error');
        if (meterData.length === 0) return showNotification('⚠️ ยังไม่มีข้อมูล', 'error');

        // Collect readings
        const readings = [];
        meterData.forEach(item => {
            const prevElec = parseFloat(document.querySelector(`input[data-contract="${item.contract_id}"][data-type="prev_elec"]`)?.value) || 0;
            const prevWater = parseFloat(document.querySelector(`input[data-contract="${item.contract_id}"][data-type="prev_water"]`)?.value) || 0;
            const currElecInput = document.querySelector(`input[data-contract="${item.contract_id}"][data-type="curr_elec"]`);
            const currWaterInput = document.querySelector(`input[data-contract="${item.contract_id}"][data-type="curr_water"]`);
            const noteInput = document.querySelector(`input.js-meter-note[data-contract="${item.contract_id}"]`);

            const currElec = parseFloat(currElecInput?.value) || 0;
            const currWater = parseFloat(currWaterInput?.value) || 0;

            readings.push({
                contract_id: parseInt(item.contract_id),
                elec_prev: prevElec,
                elec_curr: currElec,
                water_prev: prevWater,
                water_curr: currWater,
                note: noteInput?.value || null
            });
        });

        if (!confirm(`📊 ยืนยันบันทึกมิเตอร์ ${readings.length} ห้อง?\n\nเดือน: ${readingMonth}`)) return;

        btn.disabled = true;
        btnText.innerText = 'กำลังบันทึก...';

        try {
            const processedBy = localStorage.getItem('admin_username') || 'admin';
            const payload = {
                reading_month: readingMonth,
                readings: readings,
                created_by: processedBy
            };

            const res = await fetch(`${API_BASE}/meters-save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const text = await res.text();
            const raw = text ? JSON.parse(text) : null;
            const result = extractResult(raw);

            if (res.ok && result.success === true) {
                const data = result.data || {};
                showNotification(`✅ บันทึก ${data.saved_count || 0} ห้องสำเร็จ`, 'success');
                setTimeout(() => loadMeterReadings(), 1000);
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
    // 5. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 meters.js เริ่มทำงาน');

        // Default: เดือนปัจจุบัน
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const monthInput = document.getElementById('readingMonth');
        if (monthInput) monthInput.value = currentMonth;

        // ปุ่มโหลด
        window.loadMeterReadings = loadMeterReadings;
        window.saveAllMeters = saveAllMeters;

        // Auto-load เมื่อเปลี่ยนอาคาร
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

        // Auto-load ครั้งแรก
        setTimeout(() => loadMeterReadings(), 500);

        console.log('✅ meters.js โหลดสำเร็จ');
    });

})();