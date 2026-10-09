/* ==========================================
 * move-out.js - แจ้งย้ายออก (v5)
 * ⭐ v5: ระบบแจ้ง→อนุมัติ (Pending → Approved/Cancelled)
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'https://n8n_mirot.minmark.xyz/webhook';

    let allMoveOuts = [];
    let tenantsList = [];
    let lastBuildingId = '';
    let isLoading = false;
    let selectedTenant = null;

    const showNotification = window.showNotification;
    const escapeHtml = window.escapeHtml;
    const formatNumber = window.formatNumber;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

    function normalizeStatus(s) {
        return String(s || '').trim().toUpperCase();
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

    function formatDate(d) {
        if (!d) return '-';
        try {
            const date = new Date(d);
            if (isNaN(date.getTime())) return d;
            return date.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch { return d; }
    }

    function formatDateLong(d) {
        if (!d) return '-';
        try {
            const date = new Date(d);
            if (isNaN(date.getTime())) return d;
            return date.toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' });
        } catch { return d; }
    }

    function formatDateTime(d) {
        if (!d) return '-';
        try {
            const date = new Date(d);
            if (isNaN(date.getTime())) return d;
            return date.toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return d; }
    }

    function getReasonLabel(type, note) {
        const labels = {
            'END_RENTAL': '🏁 เลิกเช่า',
            'MOVE_LOCATION': '📍 ย้ายที่อยู่',
            'JOB_CHANGE': '💼 เปลี่ยนงาน',
            'PERSONAL': '👤 เหตุผลส่วนตัว',
            'OTHER': '📌 อื่นๆ'
        };
        const base = labels[type] || type || '-';
        return note ? `${base} — ${note}` : base;
    }

    function getStatusBadge(status) {
        const s = normalizeStatus(status);
        const badges = {
            'PENDING':   { label: 'รออนุมัติ',   cls: 'bg-yellow-100 text-yellow-700', icon: '🟡' },
            'APPROVED':  { label: 'อนุมัติแล้ว',  cls: 'bg-green-100 text-green-700',   icon: '🟢' },
            'COMPLETED': { label: 'เสร็จสิ้น',    cls: 'bg-green-100 text-green-700',   icon: '🟢' },
            'CANCELLED': { label: 'ยกเลิก',      cls: 'bg-red-100 text-red-700',       icon: '🔴' }
        };
        const cfg = badges[s] || badges['PENDING'];
        return `<span class="px-2.5 py-1 ${cfg.cls} rounded-full text-xs font-medium inline-block whitespace-nowrap">${cfg.icon} ${cfg.label}</span>`;
    }

    // ==========================================
    // 1. โหลด
    // ==========================================
    async function loadMoveOuts() {
        const tbody = document.getElementById('moveOutTableBody');
        if (!tbody || isLoading) return;
        isLoading = true;
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">กำลังโหลด...</td></tr>';

        try {
            const buildingId = getCurrentBuildingId();
            if (!buildingId) {
                tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">กรุณาเลือกอาคาร</td></tr>';
                isLoading = false;
                return;
            }

            const url = `${API_BASE}/move-outs?building_id=${buildingId}&_t=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const text = await res.text();
            const parsed = text ? JSON.parse(text) : [];
            allMoveOuts = toArray(parsed).filter(m => m.is_deleted !== true && m.is_deleted !== 'true');

            renderMoveOuts();

            const subtitle = document.getElementById('moveOutSubtitle');
            if (subtitle) subtitle.innerText = `ประวัติใน ${getCurrentBuildingName() || 'อาคารปัจจุบัน'}`;
        } catch (err) {
            console.error('❌ โหลดล้มเหลว:', err);
            tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-red-500">⚠️ ${escapeHtml(err.message)}</td></tr>`;
        } finally {
            isLoading = false;
        }
    }

    // ==========================================
    // 2. Render
    // ==========================================
    function renderMoveOuts() {
        const tbody = document.getElementById('moveOutTableBody');
        if (!tbody) return;

        const searchQuery = (document.getElementById('searchMoveOut')?.value || '').trim().toLowerCase();

        let filtered = allMoveOuts.filter(m => {
            if (searchQuery) {
                const name = String(m.tenant_name || '').toLowerCase();
                const room = String(m.room_number || '').toLowerCase();
                const no = String(m.move_out_no || '').toLowerCase();
                if (!name.includes(searchQuery) && !room.includes(searchQuery) && !no.includes(searchQuery)) return false;
            }
            return true;
        });

        filtered.sort((a, b) => (b.id || 0) - (a.id || 0));

        const countEl = document.getElementById('moveOutCount');
        if (countEl) countEl.innerText = filtered.length;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">
                ${allMoveOuts.length === 0 ? 'ยังไม่มีประวัติการย้ายออก' : 'ไม่พบรายการที่ตรงกับเงื่อนไข'}
            </td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(m => {
            const mStatus = normalizeStatus(m.status);
            const isPending = mStatus === 'PENDING';
            const isApproved = mStatus === 'APPROVED' || mStatus === 'COMPLETED';

            // เงินคืน
            let netHtml = '';
            const returnAmt = parseFloat(m.deposit_return) || 0;
            const shortageAmt = parseFloat(m.deposit_shortage) || 0;

            if (isPending) {
                netHtml = `<span class="text-gray-500 font-medium">ประมาณ ${formatNumber(returnAmt)} ฿</span>`;
            } else if (shortageAmt > 0) {
                netHtml = `<span class="text-red-600 font-bold">ติด ${formatNumber(shortageAmt)} ฿</span>`;
            } else {
                netHtml = `<span class="text-green-600 font-bold">คืน ${formatNumber(returnAmt)} ฿</span>`;
            }

            // ปุ่ม
            let actionButtons = '';
            if (isPending) {
                actionButtons = `
                    <button data-approve-id="${m.id}" class="js-approve bg-green-600 hover:bg-green-700 text-white px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1" title="อนุมัติ">✅ อนุมัติ</button>
                    <button data-cancel-id="${m.id}" class="js-cancel bg-red-100 hover:bg-red-200 text-red-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1" title="ยกเลิก">❌ ยกเลิก</button>
                `;
            }

            const infoButtons = `
                <button data-view-id="${m.id}" class="js-view bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1.5 rounded-md text-xs font-medium transition mr-1" title="ดู">👁️</button>
                <button data-delete-id="${m.id}" class="js-delete bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1.5 rounded-md text-xs font-medium transition" title="ลบ">🗑️</button>
            `;

            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition';
            tr.innerHTML = `
                <td class="px-4 py-3"><span class="font-bold text-red-700 text-sm">${escapeHtml(m.move_out_no || '-')}</span></td>
                <td class="px-4 py-3">
                    <div class="font-medium text-gray-800">${escapeHtml(m.tenant_name || '-')}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(m.tenant_phone || '')}</div>
                </td>
                <td class="px-4 py-3"><span class="font-bold text-blue-600">${escapeHtml(m.room_number || '-')}</span></td>
                <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${formatDate(m.move_out_date)}</td>
                <td class="px-4 py-3 whitespace-nowrap">${netHtml}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">${actionButtons}${infoButtons}</td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.js-approve').forEach(btn => {
            btn.addEventListener('click', function() { approveMoveOut(parseInt(this.getAttribute('data-approve-id'))); });
        });
        tbody.querySelectorAll('.js-cancel').forEach(btn => {
            btn.addEventListener('click', function() { cancelMoveOut(parseInt(this.getAttribute('data-cancel-id'))); });
        });
        tbody.querySelectorAll('.js-view').forEach(btn => {
            btn.addEventListener('click', function() { openViewModal(parseInt(this.getAttribute('data-view-id'))); });
        });
        tbody.querySelectorAll('.js-delete').forEach(btn => {
            btn.addEventListener('click', function() { deleteMoveOut(parseInt(this.getAttribute('data-delete-id'))); });
        });
    }

    // ==========================================
    // 3. โหลด dropdown
    // ==========================================
    async function loadMoveOutData() {
        const tenantSelect = document.getElementById('tenantSelect');
        tenantSelect.innerHTML = '<option value="">-- กำลังโหลด --</option>';

        try {
            const buildingId = getCurrentBuildingId();
            const url = `${API_BASE}/move-out-data?building_id=${buildingId}&_t=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store' });
            const data = await res.json();
            const payload = Array.isArray(data) ? data[0] : data;

            let tenants = payload.tenants || [];
            if (!Array.isArray(tenants)) tenants = tenants && Object.keys(tenants).length ? [tenants] : [];

            const seen = new Set();
            tenants = tenants.filter(t => {
                if (!t || !t.tenant_id) return false;
                if (seen.has(t.tenant_id)) return false;
                seen.add(t.tenant_id);
                return true;
            });

            // Filter ผู้เช่าที่เคยย้ายออกแล้ว
            const existingContractIds = new Set(
                allMoveOuts
                    .filter(m => normalizeStatus(m.status) !== 'CANCELLED')
                    .map(m => Number(m.contract_id))
                    .filter(id => !isNaN(id))
            );
            
            tenants = tenants.filter(t => !existingContractIds.has(Number(t.contract_id)));

            tenantsList = tenants;

            tenantSelect.innerHTML = '<option value="">-- เลือกผู้เช่า --</option>';
            if (tenantsList.length === 0) {
                tenantSelect.innerHTML = '<option value="">-- ไม่มีผู้เช่าที่พร้อมย้ายออก --</option>';
                return;
            }

            tenantsList.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.tenant_id;
                opt.textContent = `${t.tenant_name} (${t.tenant_phone || '-'}) — ห้อง ${t.room_number}`;
                opt.dataset.contractId = t.contract_id;
                opt.dataset.contractNo = t.contract_number || '';
                opt.dataset.contractEndDate = t.end_date || '';
                opt.dataset.roomId = t.room_id;
                opt.dataset.roomNumber = t.room_number;
                opt.dataset.deposit = t.deposit_amount || 0;
                opt.dataset.rentPrice = t.rent_price || 0;
                opt.dataset.initialElec = t.initial_elec_meter || 0;
                opt.dataset.initialWater = t.initial_water_meter || 0;
                opt.dataset.elecType = normalizeStatus(t.elec_charge_type) || 'PER_UNIT';
                opt.dataset.waterType = normalizeStatus(t.water_charge_type) || 'PER_UNIT';
                opt.dataset.elecFlat = t.elec_flat_rate || 0;
                opt.dataset.waterFlat = t.water_flat_rate || 0;
                tenantSelect.appendChild(opt);
            });
        } catch (err) {
            console.error('❌ โหลดล้มเหลว:', err);
            tenantSelect.innerHTML = '<option value="">-- โหลดไม่สำเร็จ --</option>';
        }
    }

    // ==========================================
    // 4. Modal Create
    // ==========================================
    async function openCreateModal() {
        if (!getCurrentBuildingId()) {
            showNotification('⚠️ กรุณาเลือกอาคารก่อน', 'error');
            return;
        }

        selectedTenant = null;
        document.getElementById('moveOutForm').reset();
        document.getElementById('currentInfo').classList.add('hidden');

        resetChargeUI();

        const today = new Date().toISOString().split('T')[0];
        document.getElementById('noticeDate').value = today;
        document.getElementById('moveOutDate').value = today;

        const modal = document.getElementById('createModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        await loadMoveOuts();
        await loadMoveOutData();
    }

    function closeCreateModal() {
        const modal = document.getElementById('createModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    function closeViewModal() {
        const modal = document.getElementById('viewModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    // ==========================================
    // 5. Reset UI
    // ==========================================
    function resetChargeUI() {
        ['elec', 'water'].forEach(kind => {
            const initialEl = document.getElementById(kind === 'elec' ? 'initialElec' : 'initialWater');
            const finalEl = document.getElementById(kind === 'elec' ? 'finalElec' : 'finalWater');
            const priceEl = document.getElementById(kind === 'elec' ? 'elecUnitPrice' : 'waterUnitPrice');
            const badgeEl = document.getElementById(kind === 'elec' ? 'elecTypeBadge' : 'waterTypeBadge');
            const priceLabelEl = document.getElementById(kind === 'elec' ? 'elecPriceLabel' : 'waterPriceLabel');
            const finalLabelEl = document.getElementById(kind === 'elec' ? 'finalElecLabel' : 'finalWaterLabel');

            if (initialEl) initialEl.value = 0;
            if (finalEl) finalEl.value = 0;
            if (priceEl) {
                priceEl.value = '';
                priceEl.disabled = false;
                priceEl.readOnly = false;
                priceEl.classList.remove('bg-yellow-100', 'border-yellow-400', 'font-bold', 'text-yellow-800');
            }
            if (badgeEl) {
                badgeEl.innerText = '';
                badgeEl.className = 'text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600';
            }
            if (priceLabelEl) priceLabelEl.innerHTML = 'ราคา/หน่วย (฿)';
            if (finalLabelEl) finalLabelEl.innerText = 'เลขครั้งสุดท้าย';
            if (finalEl) finalEl.disabled = false;
        });
    }

    function applyChargeTypeUI(kind, type, flatRate) {
        const initialEl = document.getElementById(kind === 'elec' ? 'initialElec' : 'initialWater');
        const finalEl = document.getElementById(kind === 'elec' ? 'finalElec' : 'finalWater');
        const priceEl = document.getElementById(kind === 'elec' ? 'elecUnitPrice' : 'waterUnitPrice');
        const badgeEl = document.getElementById(kind === 'elec' ? 'elecTypeBadge' : 'waterTypeBadge');
        const priceLabelEl = document.getElementById(kind === 'elec' ? 'elecPriceLabel' : 'waterPriceLabel');
        const finalLabelEl = document.getElementById(kind === 'elec' ? 'finalElecLabel' : 'finalWaterLabel');

        const isFlat = type === 'FLAT_RATE' && flatRate > 0;

        if (isFlat) {
            initialEl.disabled = true;
            finalEl.disabled = true;
            initialEl.classList.add('bg-gray-200', 'text-gray-400');
            finalEl.classList.add('bg-gray-200', 'text-gray-400');
            priceEl.value = flatRate;
            priceEl.disabled = true;
            priceEl.readOnly = true;
            priceEl.classList.add('bg-yellow-100', 'border-yellow-400', 'font-bold', 'text-yellow-800');
            priceLabelEl.innerHTML = `💰 ราคาเหมาจ่าย (฿)<span class="ml-1 text-yellow-700 text-xs">(จากสัญญา)</span>`;
            finalLabelEl.innerText = 'มิเตอร์ครั้งสุดท้าย';
            badgeEl.innerText = '💼 เหมาจ่าย';
            badgeEl.className = 'text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300';
            initialEl.value = 0;
            finalEl.value = 0;
        } else {
            initialEl.disabled = false;
            finalEl.disabled = false;
            initialEl.classList.remove('bg-gray-200', 'text-gray-400');
            finalEl.classList.remove('bg-gray-200', 'text-gray-400');
            priceEl.disabled = false;
            priceEl.readOnly = false;
            priceEl.classList.remove('bg-yellow-100', 'border-yellow-400', 'font-bold', 'text-yellow-800');
            priceEl.value = '';
            priceLabelEl.innerHTML = `ราคา/หน่วย (฿)<span class="ml-1 text-gray-400 text-xs">(กรอกเอง)</span>`;
            finalLabelEl.innerText = 'เลขครั้งสุดท้าย';
            badgeEl.innerText = '📊 ต่อหน่วย';
            badgeEl.className = 'text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300';
        }
    }

    // ==========================================
    // 6. เลือกผู้เช่า
    // ==========================================
    function onTenantChange(e) {
        const opt = e.target.selectedOptions[0];
        const infoBox = document.getElementById('currentInfo');

        if (!opt || !opt.value) {
            infoBox.classList.add('hidden');
            selectedTenant = null;
            resetChargeUI();
            recalcSummary();
            return;
        }

        selectedTenant = {
            tenant_id: opt.value,
            contract_id: opt.dataset.contractId,
            contract_no: opt.dataset.contractNo,
            contract_end_date: opt.dataset.contractEndDate || null,
            room_id: opt.dataset.roomId,
            room_number: opt.dataset.roomNumber,
            deposit: parseFloat(opt.dataset.deposit) || 0,
            rent_price: parseFloat(opt.dataset.rentPrice) || 0,
            initial_elec: parseFloat(opt.dataset.initialElec) || 0,
            initial_water: parseFloat(opt.dataset.initialWater) || 0,
            elec_type: opt.dataset.elecType,
            water_type: opt.dataset.waterType,
            elec_flat: parseFloat(opt.dataset.elecFlat) || 0,
            water_flat: parseFloat(opt.dataset.waterFlat) || 0
        };

        document.getElementById('infoRoom').innerText = selectedTenant.room_number || '-';
        document.getElementById('infoContractNo').innerText = selectedTenant.contract_no || '-';
        document.getElementById('infoRent').innerText = formatNumber(selectedTenant.rent_price) + ' ฿';
        document.getElementById('infoDeposit').innerText = formatNumber(selectedTenant.deposit) + ' ฿';

        document.getElementById('initialElec').value = selectedTenant.initial_elec;
        document.getElementById('initialWater').value = selectedTenant.initial_water;
        document.getElementById('finalElec').value = selectedTenant.initial_elec;
        document.getElementById('finalWater').value = selectedTenant.initial_water;

        applyChargeTypeUI('elec', selectedTenant.elec_type, selectedTenant.elec_flat);
        applyChargeTypeUI('water', selectedTenant.water_type, selectedTenant.water_flat);

        infoBox.classList.remove('hidden');
        recalcSummary();
    }

    function checkEarlyTermination() {
        if (!selectedTenant || !selectedTenant.contract_end_date) return { isEarly: false };
        const moveOutDateStr = document.getElementById('moveOutDate').value;
        if (!moveOutDateStr) return { isEarly: false };
        
        const endDate = new Date(selectedTenant.contract_end_date);
        if (isNaN(endDate.getTime())) return { isEarly: false };
        
        const moveOut = new Date(moveOutDateStr);
        const isEarly = moveOut < endDate;
        const daysLeft = isEarly ? Math.ceil((endDate - moveOut) / (1000 * 60 * 60 * 24)) : 0;
        
        return { isEarly, daysLeft, endDate: selectedTenant.contract_end_date, deposit: selectedTenant.deposit };
    }

    // ==========================================
    // 7. คำนวณ
    // ==========================================
    function recalcSummary() {
        if (!selectedTenant) {
            document.getElementById('sumDeposit').innerText = '0 ฿';
            document.getElementById('sumElec').innerText = '-0 ฿';
            document.getElementById('sumWater').innerText = '-0 ฿';
            document.getElementById('sumOutstanding').innerText = '-0 ฿';
            document.getElementById('sumDamage').innerText = '-0 ฿';
            document.getElementById('sumOther').innerText = '-0 ฿';
            document.getElementById('sumNet').innerText = '0 ฿';
            document.getElementById('shortageWarning').classList.add('hidden');
            return;
        }

        const deposit = selectedTenant.deposit;

        let elecAmount = 0;
        const elecIsFlat = selectedTenant.elec_type === 'FLAT_RATE' && selectedTenant.elec_flat > 0;
        if (elecIsFlat) {
            elecAmount = selectedTenant.elec_flat;
        } else {
            const init = parseFloat(document.getElementById('initialElec').value) || 0;
            const final = parseFloat(document.getElementById('finalElec').value) || 0;
            const price = parseFloat(document.getElementById('elecUnitPrice').value) || 0;
            elecAmount = Math.max(final - init, 0) * price;
        }

        let waterAmount = 0;
        const waterIsFlat = selectedTenant.water_type === 'FLAT_RATE' && selectedTenant.water_flat > 0;
        if (waterIsFlat) {
            waterAmount = selectedTenant.water_flat;
        } else {
            const init = parseFloat(document.getElementById('initialWater').value) || 0;
            const final = parseFloat(document.getElementById('finalWater').value) || 0;
            const price = parseFloat(document.getElementById('waterUnitPrice').value) || 0;
            waterAmount = Math.max(final - init, 0) * price;
        }

        const damageFee = parseFloat(document.getElementById('damageFee').value) || 0;
        const otherDed = parseFloat(document.getElementById('otherDeduction').value) || 0;

        const earlyCheck = checkEarlyTermination();
        let net = 0;

        if (earlyCheck.isEarly) {
            net = -(elecAmount + waterAmount + damageFee + otherDed);
        } else {
            net = deposit - (elecAmount + waterAmount + damageFee + otherDed);
        }

        const elecLabel = elecIsFlat ? `${formatNumber(elecAmount)} ฿ (เหมาจ่าย)` : `${formatNumber(elecAmount)} ฿`;
        const waterLabel = waterIsFlat ? `${formatNumber(waterAmount)} ฿ (เหมาจ่าย)` : `${formatNumber(waterAmount)} ฿`;
        
        document.getElementById('elecAmount').innerText = elecLabel;
        document.getElementById('waterAmount').innerText = waterLabel;

        document.getElementById('sumDeposit').innerText = formatNumber(deposit) + ' ฿';
        document.getElementById('sumElec').innerText = '-' + formatNumber(elecAmount) + ' ฿';
        document.getElementById('sumWater').innerText = '-' + formatNumber(waterAmount) + ' ฿';
        document.getElementById('sumDamage').innerText = '-' + formatNumber(damageFee) + ' ฿';
        document.getElementById('sumOther').innerText = '-' + formatNumber(otherDed) + ' ฿';

        const netEl = document.getElementById('sumNet');
        const labelEl = document.getElementById('netLabel');
        const warningEl = document.getElementById('shortageWarning');

        if (earlyCheck.isEarly) {
            labelEl.innerText = '🚨 ออกก่อนครบขั้นต่ำ — ยึดประกัน';
            netEl.innerText = `ต้องจ่ายเพิ่ม ${formatNumber(Math.abs(net))} ฿`;
            netEl.className = 'text-red-700';
            warningEl.innerText = `⚠️ ออกก่อนครบสัญญาขั้นต่ำ (อีก ${earlyCheck.daysLeft} วัน) — เงินประกัน ${formatNumber(deposit)} ฿ ถูกยึด`;
            warningEl.classList.remove('hidden');
        } else if (net >= 0) {
            labelEl.innerText = 'เงินคืนผู้เช่า:';
            netEl.innerText = formatNumber(net) + ' ฿';
            netEl.className = 'text-green-700';
            warningEl.classList.add('hidden');
        } else {
            labelEl.innerText = 'ผู้เช่าต้องจ่ายเพิ่ม:';
            netEl.innerText = formatNumber(Math.abs(net)) + ' ฿';
            netEl.className = 'text-red-700';
            warningEl.innerText = '⚠️ เงินประกันไม่พอหักค่าใช้จ่าย';
            warningEl.classList.remove('hidden');
        }
    }

    // ==========================================
    // 8. บันทึก (สร้างคำร้อง PENDING)
    // ==========================================
    async function saveMoveOut(e) {
        e.preventDefault();

        const btn = document.getElementById('saveBtn');
        const btnText = document.getElementById('saveBtnText');

        const tenantId = document.getElementById('tenantSelect').value;
        const noticeDate = document.getElementById('noticeDate').value;
        const moveOutDate = document.getElementById('moveOutDate').value;
        const reasonType = document.getElementById('reasonType').value;
        const reasonNote = document.getElementById('reasonNote').value.trim();
        const finalElec = parseFloat(document.getElementById('finalElec').value) || 0;
        const finalWater = parseFloat(document.getElementById('finalWater').value) || 0;
        const elecPrice = parseFloat(document.getElementById('elecUnitPrice').value) || 0;
        const waterPrice = parseFloat(document.getElementById('waterUnitPrice').value) || 0;
        const damageFee = parseFloat(document.getElementById('damageFee').value) || 0;
        const damageNote = document.getElementById('damageNote').value.trim();
        const otherDed = parseFloat(document.getElementById('otherDeduction').value) || 0;
        const otherNote = document.getElementById('otherDeductionNote').value.trim();
        const note = document.getElementById('note').value.trim();

        if (!tenantId) return showNotification('⚠️ กรุณาเลือกผู้เช่า', 'error');
        if (!moveOutDate) return showNotification('⚠️ กรุณาเลือกวันที่ย้ายออก', 'error');
        if (!noticeDate) return showNotification('⚠️ กรุณาเลือกวันที่แจ้ง', 'error');
        if (!selectedTenant || !selectedTenant.contract_id) return showNotification('⚠️ ไม่พบข้อมูลสัญญา', 'error');
        if (damageFee > 0 && !damageNote) return showNotification('⚠️ กรุณากรอกรายละเอียดค่าเสียหาย', 'error');
        if (otherDed > 0 && !otherNote) return showNotification('⚠️ กรุณากรอกรายละเอียดหักอื่นๆ', 'error');

        const processedBy = localStorage.getItem('admin_username') || 'admin';
        const earlyCheck = checkEarlyTermination();

        let confirmMsg = '⚠️ ยืนยันการแจ้งย้ายออก?\n\nระบบจะบันทึกคำร้อง (รออนุมัติ)\nยังไม่ย้ายจริงจนกว่าจะกดอนุมัติ';
        if (earlyCheck.isEarly) {
            confirmMsg += `\n\n🚨 เตือน: ออกก่อนครบขั้นต่ำ (อีก ${earlyCheck.daysLeft} วัน)`;
        }

        if (!confirm(confirmMsg)) return;

        btn.disabled = true;
        btnText.innerText = 'กำลังบันทึก...';

        try {
            const payload = {
                tenant_id: parseInt(tenantId),
                contract_id: parseInt(selectedTenant.contract_id),
                move_out_date: moveOutDate,
                reason_type: reasonType,
                reason: reasonNote || null,
                notice_date: noticeDate,
                final_elec_meter: finalElec,
                final_water_meter: finalWater,
                elec_unit_price: elecPrice,
                water_unit_price: waterPrice,
                damage_fee: damageFee,
                damage_note: damageNote || null,
                other_deduction: otherDed,
                other_deduction_note: otherNote || null,
                note: note || null,
                processed_by: processedBy
            };

            const res = await fetch(`${API_BASE}/move-outs-create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const text = await res.text();
            const raw = text ? JSON.parse(text) : null;
            const result = extractResult(raw);

            if (res.ok && result.success === true) {
                closeCreateModal();
                showNotification('✅ แจ้งย้ายออกสำเร็จ (รออนุมัติ)', 'success');
                setTimeout(() => loadMoveOuts(), 500);
            } else {
                throw new Error(result.message || `HTTP ${res.status}`);
            }
        } catch (err) {
            console.error('❌ ล้มเหลว:', err);
            showNotification('❌ ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btnText.innerText = '✅ ยืนยันการแจ้ง';
        }
    }

    // ==========================================
    // 9. Approve
    // ==========================================
    async function approveMoveOut(requestId) {
        if (!confirm('✅ ยืนยันการอนุมัติย้ายออก?\n\nระบบจะ:\n• ปิดสัญญา\n• คืนห้องเป็น "ว่าง"\n• คำนวณเงินคืน/ยึดประกัน')) return;

        const processedBy = localStorage.getItem('admin_username') || 'admin';

        try {
            const res = await fetch(`${API_BASE}/move-outs-approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request_id: requestId, approved_by: processedBy })
            });
            const text = await res.text();
            const raw = text ? JSON.parse(text) : null;
            const result = extractResult(raw);

            if (res.ok && result.success === true) {
                const data = result.data || {};
                let msg = '✅ อนุมัติย้ายออกสำเร็จ';
                if (data.deposit_shortage > 0) {
                    msg += ` (ติด ${formatNumber(data.deposit_shortage)} ฿)`;
                } else if (data.deposit_return > 0) {
                    msg += ` (คืน ${formatNumber(data.deposit_return)} ฿)`;
                }
                showNotification(msg, 'success');
                setTimeout(() => loadMoveOuts(), 500);
            } else {
                throw new Error(result.message || 'ไม่สำเร็จ');
            }
        } catch (err) {
            console.error('❌ approve failed:', err);
            showNotification('❌ ' + err.message, 'error');
        }
    }

    // ==========================================
    // 10. Cancel
    // ==========================================
    async function cancelMoveOut(requestId) {
        const reason = prompt('❌ เหตุผลที่ยกเลิก (ถ้าไม่มี กด OK):');
        if (reason === null) return;

        const processedBy = localStorage.getItem('admin_username') || 'admin';

        try {
            const res = await fetch(`${API_BASE}/move-outs-cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    request_id: requestId, 
                    reason: reason || null,
                    cancelled_by: processedBy 
                })
            });
            const text = await res.text();
            const raw = text ? JSON.parse(text) : null;
            const result = extractResult(raw);

            if (res.ok && result.success === true) {
                showNotification('🗑️ ยกเลิกคำร้องสำเร็จ', 'success');
                setTimeout(() => loadMoveOuts(), 500);
            } else {
                throw new Error(result.message || 'ไม่สำเร็จ');
            }
        } catch (err) {
            console.error('❌ cancel failed:', err);
            showNotification('❌ ' + err.message, 'error');
        }
    }

    // ==========================================
    // 11. View Modal
    // ==========================================
    function openViewModal(id) {
        const m = allMoveOuts.find(x => Number(x.id) === Number(id));
        if (!m) return;

        document.getElementById('viewMoveOutNo').innerText = m.move_out_no || '-';
        document.getElementById('viewMoveOutDate').innerText = `ย้ายออก: ${formatDateLong(m.move_out_date)}`;
        document.getElementById('viewStatusBadge').innerHTML = getStatusBadge(m.status);
        document.getElementById('viewTenantName').innerText = m.tenant_name || '-';
        document.getElementById('viewTenantPhone').innerText = m.tenant_phone || '-';
        document.getElementById('viewRoom').innerText = m.room_number || '-';
        document.getElementById('viewContractNo').innerText = m.contract_number || '-';
        document.getElementById('viewReason').innerText = getReasonLabel(m.reason_type, m.reason);

        document.getElementById('viewDeposit').innerText = formatNumber(m.deposit_amount) + ' ฿';
        document.getElementById('viewElec').innerText = '-' + formatNumber(m.elec_final_amount) + ' ฿';
        document.getElementById('viewWater').innerText = '-' + formatNumber(m.water_final_amount) + ' ฿';
        document.getElementById('viewOutstanding').innerText = '-' + formatNumber(m.outstanding_debt) + ' ฿';
        document.getElementById('viewDamage').innerText = '-' + formatNumber(m.damage_fee) + ' ฿';
        document.getElementById('viewOther').innerText = '-' + formatNumber(m.other_deduction) + ' ฿';

        const returnAmt = parseFloat(m.deposit_return) || 0;
        const shortAmt = parseFloat(m.deposit_shortage) || 0;

        if (shortAmt > 0) {
            document.getElementById('viewNetLabel').innerText = 'ผู้เช่าติด:';
            document.getElementById('viewNet').innerText = formatNumber(shortAmt) + ' ฿';
            document.getElementById('viewNet').className = 'text-red-700 font-bold';
        } else {
            document.getElementById('viewNetLabel').innerText = 'เงินคืน:';
            document.getElementById('viewNet').innerText = formatNumber(returnAmt) + ' ฿';
            document.getElementById('viewNet').className = 'text-green-700 font-bold';
        }

        const noteWrap = document.getElementById('viewNoteWrap');
        if (m.note) {
            document.getElementById('viewNote').innerText = m.note;
            noteWrap.classList.remove('hidden');
        } else {
            noteWrap.classList.add('hidden');
        }

        document.getElementById('viewProcessedBy').innerText = m.processed_by || '-';
        document.getElementById('viewProcessedAt').innerText = formatDateTime(m.processed_at || m.created_at);

        document.getElementById('viewDeleteBtn').onclick = () => {
            if (confirm('⚠️ ลบรายการย้ายออกนี้?')) {
                closeViewModal();
                deleteMoveOut(m.id);
            }
        };

        const modal = document.getElementById('viewModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    // ==========================================
    // 12. Delete
    // ==========================================
    async function deleteMoveOut(id) {
        if (!confirm('⚠️ ลบรายการย้ายออกนี้?\n\n(ประวัติจะยังอยู่ในฐานข้อมูล)')) return;

        try {
            const res = await fetch(`${API_BASE}/move-outs-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            const text = await res.text();

            if (res.ok && (!text || text.trim() === '' || text === '[]')) {
                await new Promise(r => setTimeout(r, 500));
                await loadMoveOuts();
                showNotification('🗑️ ลบสำเร็จ', 'success');
                return;
            }

            let raw = null;
            try { raw = text ? JSON.parse(text) : null; } catch(_) {}
            const result = extractResult(raw);

            if (res.ok && result.success === true) {
                showNotification('🗑️ ลบสำเร็จ', 'success');
                setTimeout(() => loadMoveOuts(), 500);
            } else {
                throw new Error(result.message || 'ไม่สำเร็จ');
            }
        } catch (err) {
            console.error('❌ ลบล้มเหลว:', err);
            showNotification('❌ ' + err.message, 'error');
        }
    }

    // ==========================================
    // 13. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 move-out.js v5 เริ่มทำงาน');

        setTimeout(() => loadMoveOuts(), 300);

        document.getElementById('moveOutForm').addEventListener('submit', saveMoveOut);
        document.getElementById('tenantSelect').addEventListener('change', onTenantChange);

        ['finalElec', 'finalWater', 'elecUnitPrice', 'waterUnitPrice', 'damageFee', 'otherDeduction'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', recalcSummary);
        });

        document.getElementById('moveOutDate').addEventListener('change', recalcSummary);
        document.getElementById('moveOutDate').addEventListener('input', recalcSummary);

        document.getElementById('searchMoveOut').addEventListener('input', () => {
            clearTimeout(window._moTimer);
            window._moTimer = setTimeout(renderMoveOuts, 200);
        });

        window.addEventListener('buildingChanged', () => loadMoveOuts());

        lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const cur = getCurrentBuildingId();
            if (cur !== lastBuildingId) {
                lastBuildingId = cur;
                loadMoveOuts();
            }
        }, 1000);

        window.openCreateModal = openCreateModal;
        window.closeCreateModal = closeCreateModal;
        window.closeViewModal = closeViewModal;
        window.deleteMoveOut = deleteMoveOut;
        window.approveMoveOut = approveMoveOut;
        window.cancelMoveOut = cancelMoveOut;
        window.loadMoveOuts = loadMoveOuts;

        console.log('✅ move-out.js v5 โหลดสำเร็จ');
    });

})();
