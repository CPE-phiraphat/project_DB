/* ==========================================
 * contracts.js - จัดการทะเบียนสัญญาเช่า (v8)
 * ⭐ v8: ป้องกันผู้เช่า/ห้องซ้ำ + ใช้ allContracts ตรวจ
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'https://n8n_mirot.minmark.xyz/webhook';

    let allContracts = [];
    let allTenants = [];
    let allRooms = [];
    let currentEditingContractId = null;
    let deletingContractId = null;
    let lastBuildingId = '';
    let isLoading = false;
    let selectedTenant = null;
    let selectedRoom = null;

    const showNotification = window.showNotification;
    const escapeHtml = window.escapeHtml;
    const formatNumber = window.formatNumber;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

    // ==========================================
    // ⭐ Helper: Normalize Status
    // ==========================================
    function normalizeStatus(s) {
        return String(s || '').trim().toUpperCase();
    }

    function normalizeContractStatus(s) {
        const u = normalizeStatus(s);
        if (u === 'TERMINATED' || u === 'CANCELLED' || u === 'ENDED') return 'TERMINATED';
        if (u === 'ACTIVE') return 'ACTIVE';
        if (u === 'PENDING') return 'PENDING';
        return u || 'ACTIVE';
    }

    function normalizeRoomStatus(s) {
        const u = normalizeStatus(s);
        if (u === 'VACANT') return 'AVAILABLE';
        if (u === 'REPAIR') return 'MAINTENANCE';
        return u;
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

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch { return dateStr; }
    }

    function formatDateLong(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' });
        } catch { return dateStr; }
    }

    function daysBetween(date1, date2) {
        return Math.ceil((new Date(date2) - new Date(date1)) / (1000 * 60 * 60 * 24));
    }

    function formatIdCard(idCard) {
        if (!idCard) return '-';
        if (String(idCard).startsWith('TMP')) return '⏳ ชั่วคราว';
        const clean = String(idCard).replace(/\D/g, '');
        if (clean.length !== 13) return idCard;
        return `${clean[0]}-${clean.slice(1,5)}-${clean.slice(5,10)}-${clean.slice(10,12)}-${clean.slice(12)}`;
    }

    // ⭐ ตรวจสอบสถานะสัญญา
    function getContractStatus(c) {
        const s = normalizeContractStatus(c.status);
        if (s === 'TERMINATED') return 'terminated';
        if (s === 'PENDING') return 'pending';
        return 'active';
    }

    // ⭐ เช็คสถานะ "ครบสัญญาขั้นต่ำ"
    function getMinPeriodInfo(c) {
        if (!c.end_date || !c.start_date) return { status: 'unknown', daysLeft: 0 };
        const today = new Date();
        const endDate = new Date(c.end_date);
        const daysLeft = daysBetween(today, endDate);
        
        if (daysLeft > 0) {
            return { status: 'in_min_period', daysLeft };
        }
        return { status: 'passed_min', daysLeft };
    }

    function getStatusBadge(status) {
        const badges = {
            'active':     { label: 'กำลังเช่า',   cls: 'bg-green-100 text-green-700',  icon: '🟢' },
            'pending':    { label: 'รอเริ่ม',     cls: 'bg-blue-100 text-blue-700',    icon: '🔵' },
            'terminated': { label: 'จบสัญญา',     cls: 'bg-gray-200 text-gray-700',    icon: '⚫' }
        };
        const cfg = badges[status] || badges['active'];
        return `<span class="px-2.5 py-1 ${cfg.cls} rounded-full text-xs font-medium inline-block whitespace-nowrap">${cfg.icon} ${cfg.label}</span>`;
    }

    // ⭐ Helper: สลับ block ตาม charge type
    function updateMeterBlocks(typeSelectId, perUnitBlockId, flatRateBlockId) {
        const typeEl = document.getElementById(typeSelectId);
        const perUnitBlock = document.getElementById(perUnitBlockId);
        const flatRateBlock = document.getElementById(flatRateBlockId);
        if (!typeEl || !perUnitBlock || !flatRateBlock) return;
        
        if (typeEl.value === 'flat_rate') {
            perUnitBlock.classList.add('hidden');
            flatRateBlock.classList.remove('hidden');
        } else {
            perUnitBlock.classList.remove('hidden');
            flatRateBlock.classList.add('hidden');
        }
    }

    // ==========================================
    // ⭐ Helper: หา tenant ที่มี ACTIVE แล้ว
    // ==========================================
    function getActiveTenantIds() {
        const ids = new Set();
        allContracts
            .filter(c => c.is_deleted !== true && c.is_deleted !== 'true')
            .filter(c => normalizeContractStatus(c.status) === 'ACTIVE')
            .forEach(c => {
                const tid = Number(c.tenant_id);
                if (!isNaN(tid)) ids.add(tid);
            });
        return ids;
    }

    function getActiveRoomIds() {
        const ids = new Set();
        allContracts
            .filter(c => c.is_deleted !== true && c.is_deleted !== 'true')
            .filter(c => normalizeContractStatus(c.status) === 'ACTIVE')
            .forEach(c => {
                const rid = Number(c.room_id);
                if (!isNaN(rid)) ids.add(rid);
            });
        return ids;
    }

    // ==========================================
    // 1. โหลดสัญญา
    // ==========================================
    async function loadContracts() {
        const tbody = document.getElementById('contractTableBody');
        if (!tbody || isLoading) return;
        isLoading = true;

        tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">กำลังโหลดข้อมูล...</td></tr>';

        try {
            const buildingId = getCurrentBuildingId();
            if (!buildingId) {
                tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">กรุณาเลือกอาคารก่อน</td></tr>';
                isLoading = false;
                return;
            }

            const url = `${API_BASE}/contracts?building_id=${buildingId}&_t=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            let contracts = toArray(parsed);
            
            allContracts = contracts.filter(c => c.is_deleted !== true && c.is_deleted !== 'true');
            
            console.log(`📦 โหลด ${allContracts.length} สัญญา`);
            renderContracts();
            
            const subtitle = document.getElementById('contractSubtitle');
            if (subtitle) subtitle.innerText = `สัญญาเช่าใน ${getCurrentBuildingName() || 'อาคารปัจจุบัน'}`;
        } catch (error) {
            console.error('❌ โหลดสัญญาล้มเหลว:', error);
            tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-red-500">⚠️ ${escapeHtml(error.message)}</td></tr>`;
        } finally {
            isLoading = false;
        }
    }

    // ==========================================
    // 2. Render
    // ==========================================
    function renderContracts() {
        const tbody = document.getElementById('contractTableBody');
        if (!tbody) return;

        const statusFilter = document.getElementById('statusFilter')?.value || '';
        const searchQuery = (document.getElementById('searchContract')?.value || '').trim().toLowerCase();

        let filtered = allContracts.filter(c => {
            const status = getContractStatus(c);
            if (statusFilter && status !== statusFilter) return false;
            if (searchQuery) {
                const name = String(c.tenant_name || '').toLowerCase();
                const room = String(c.room_number || '').toLowerCase();
                const contractNo = String(c.contract_number || '').toLowerCase();
                if (!name.includes(searchQuery) && !room.includes(searchQuery) && !contractNo.includes(searchQuery)) return false;
            }
            return true;
        });

        filtered.sort((a, b) => (b.contract_id || 0) - (a.contract_id || 0));

        const countEl = document.getElementById('contractCount');
        if (countEl) countEl.innerText = filtered.length;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">
                ${allContracts.length === 0 ? 'ยังไม่มีสัญญาเช่าในอาคารนี้' : 'ไม่พบสัญญาที่ตรงกับเงื่อนไข'}
            </td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(c => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition';

            const status = getContractStatus(c);
            const statusBadge = getStatusBadge(status);
            const contractNo = c.contract_number || `CT-${String(c.contract_id).padStart(5, '0')}`;

            let endDateHtml = formatDate(c.end_date);
            if (c.end_date && status === 'active') {
                const minInfo = getMinPeriodInfo(c);
                if (minInfo.status === 'in_min_period') {
                    endDateHtml += `<span class="block text-xs text-blue-600 font-medium mt-1">⏳ ขั้นต่ำอีก ${minInfo.daysLeft} วัน</span>`;
                } else if (minInfo.status === 'passed_min') {
                    endDateHtml += `<span class="block text-xs text-green-600 font-medium mt-1">✅ ครบขั้นต่ำแล้ว (อยู่ต่อได้)</span>`;
                }
            }

            tr.innerHTML = `
                <td class="px-4 py-3"><span class="font-bold text-blue-700 text-sm">${escapeHtml(contractNo)}</span></td>
                <td class="px-4 py-3">
                    <span class="font-bold text-blue-600">${escapeHtml(c.room_number || '-')}</span>
                    <span class="block text-xs text-gray-400">${escapeHtml(c.room_type || '')}</span>
                </td>
                <td class="px-4 py-3">
                    <div class="font-medium text-gray-800">${escapeHtml(c.tenant_name || '-')}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(c.tenant_phone || '')}</div>
                </td>
                <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${formatDate(c.start_date)}</td>
                <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${endDateHtml}</td>
                <td class="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">${formatNumber(c.rent_price)} ฿</td>
                <td class="px-4 py-3">${statusBadge}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                    <button data-view-id="${c.contract_id}" class="js-view-contract bg-purple-100 hover:bg-purple-200 text-purple-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1">👁️ ดู</button>
                    <button data-edit-id="${c.contract_id}" class="js-edit-contract bg-blue-100 hover:bg-blue-200 text-blue-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1">✏️ แก้ไข</button>
                    <button data-delete-id="${c.contract_id}" class="js-delete-contract bg-red-100 hover:bg-red-200 text-red-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition">🚫 จบสัญญา</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.js-view-contract').forEach(btn => {
            btn.addEventListener('click', function() { openViewContractModal(parseInt(this.getAttribute('data-view-id'))); });
        });
        tbody.querySelectorAll('.js-edit-contract').forEach(btn => {
            btn.addEventListener('click', function() { openEditContractModal(parseInt(this.getAttribute('data-edit-id'))); });
        });
        tbody.querySelectorAll('.js-delete-contract').forEach(btn => {
            btn.addEventListener('click', function() {
                const id = parseInt(this.getAttribute('data-delete-id'));
                const contract = allContracts.find(x => Number(x.contract_id) === id);
                openDeleteContractModal(id, contract?.tenant_name || '');
            });
        });
    }

    // ==========================================
    // 3. Search — ⭐ ใช้ allContracts ตรวจผู้มี ACTIVE
    // ==========================================
    async function loadTenantsForSearch() {
        try {
            const buildingId = getCurrentBuildingId();
            const url = `${API_BASE}/tenants?building_id=${buildingId}&_t=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            allTenants = toArray(parsed).filter(t => t.is_deleted !== true && t.is_deleted !== 'true');

            // ⭐ ใช้ allContracts เพื่อหา ACTIVE tenant
            const activeTenantIds = getActiveTenantIds();
            console.log('🔍 ผู้เช่าที่มี ACTIVE อยู่:', [...activeTenantIds]);

            return allTenants.filter(t => !activeTenantIds.has(Number(t.tenant_id)));
        } catch (error) {
            console.error('❌ โหลดผู้เช่าล้มเหลว:', error);
            return [];
        }
    }

    async function loadRoomsForSearch() {
        try {
            const buildingId = getCurrentBuildingId();
            const url = `${API_BASE}/rooms?building_id=${buildingId}&_t=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            allRooms = toArray(parsed).filter(r => r.is_deleted !== true && r.is_deleted !== 'true');

            // ⭐ ใช้ allContracts เพื่อหา ACTIVE room
            const activeRoomIds = getActiveRoomIds();

            return allRooms.filter(r => {
                const s = normalizeRoomStatus(r.status);
                if (s !== 'AVAILABLE' && s !== 'BOOKED') return false;
                // ⭐ กันห้องที่มี ACTIVE contract แล้ว
                return !activeRoomIds.has(Number(r.room_id));
            });
        } catch (error) {
            console.error('❌ โหลดห้องล้มเหลว:', error);
            return [];
        }
    }

    function setupTenantSearch() {
        const input = document.getElementById('tenantSearch');
        const results = document.getElementById('tenantResults');
        const selectedLabel = document.getElementById('tenantSelected');
        if (!input || !results) return;

        input.addEventListener('input', async function() {
            const q = this.value.trim().toLowerCase();
            if (q.length < 1) { results.classList.add('hidden'); return; }
            
            const availableTenants = await loadTenantsForSearch();
            const matched = availableTenants.filter(t => {
                const name = `${t.first_name || ''} ${t.last_name || ''}`.toLowerCase();
                const phone = String(t.phone || '').toLowerCase();
                const idCard = String(t.id_card || '').toLowerCase();
                return name.includes(q) || phone.includes(q) || idCard.includes(q);
            }).slice(0, 20);
            
            if (matched.length === 0) {
                results.innerHTML = '<div class="p-3 text-sm text-gray-500 text-center">ไม่พบผู้เช่าที่ตรงกัน (หรือมีสัญญา ACTIVE อยู่แล้ว)</div>';
                results.classList.remove('hidden');
                return;
            }
            
            results.innerHTML = '';
            matched.forEach(t => {
                const div = document.createElement('div');
                div.className = 'search-result-item p-3 border-b border-gray-100 cursor-pointer transition';
                div.innerHTML = `
                    <div class="font-medium text-gray-800">${escapeHtml(t.first_name || '')} ${escapeHtml(t.last_name || '')}</div>
                    <div class="text-xs text-gray-500">📞 ${escapeHtml(t.phone || '-')} • ${escapeHtml(formatIdCard(t.id_card))}</div>
                `;
                div.addEventListener('click', () => {
                    selectedTenant = t;
                    document.getElementById('tenantIdValue').value = t.tenant_id;
                    document.getElementById('tenantSearch').value = `${t.first_name || ''} ${t.last_name || ''}`;
                    selectedLabel.innerText = `✓ เลือก: ${t.first_name || ''} ${t.last_name || ''} (${t.phone || ''})`;
                    results.classList.add('hidden');
                });
                results.appendChild(div);
            });
            results.classList.remove('hidden');
        });

        document.addEventListener('click', function(e) {
            if (!input.contains(e.target) && !results.contains(e.target)) results.classList.add('hidden');
        });
    }

    function setupRoomSearch() {
        const input = document.getElementById('roomSearch');
        const results = document.getElementById('roomResults');
        const selectedLabel = document.getElementById('roomSelected');
        if (!input || !results) return;

        input.addEventListener('input', async function() {
            const q = this.value.trim().toLowerCase();
            if (q.length < 1) { results.classList.add('hidden'); return; }
            
            const availableRooms = await loadRoomsForSearch();
            const matched = availableRooms.filter(r => {
                const roomNo = String(r.room_number || '').toLowerCase();
                const roomType = String(r.room_type || '').toLowerCase();
                return roomNo.includes(q) || roomType.includes(q);
            }).slice(0, 20);
            
            if (matched.length === 0) {
                results.innerHTML = '<div class="p-3 text-sm text-gray-500 text-center">ไม่พบห้องที่ตรงกัน (หรือมีผู้เช่าอยู่แล้ว)</div>';
                results.classList.remove('hidden');
                return;
            }
            
            results.innerHTML = '';
            matched.forEach(r => {
                const div = document.createElement('div');
                div.className = 'search-result-item p-3 border-b border-gray-100 cursor-pointer transition';
                const rs = normalizeRoomStatus(r.status);
                const statusLabel = rs === 'AVAILABLE' ? '🟢 ว่าง' : (rs === 'BOOKED' ? '🟡 จองแล้ว' : rs);
                div.innerHTML = `
                    <div class="flex justify-between items-center">
                        <div>
                            <div class="font-bold text-blue-600 text-base">ห้อง ${escapeHtml(r.room_number)}</div>
                            <div class="text-xs text-gray-500">${escapeHtml(r.room_type || '')} • ${escapeHtml(statusLabel)}</div>
                        </div>
                        <div class="text-right">
                            <div class="text-sm font-bold text-green-600">${formatNumber(r.default_price)} ฿</div>
                            <div class="text-xs text-gray-400">ต่อเดือน</div>
                        </div>
                    </div>
                `;
                div.addEventListener('click', () => {
                    selectedRoom = r;
                    document.getElementById('roomIdValue').value = r.room_id;
                    document.getElementById('roomSearch').value = r.room_number;
                    document.getElementById('rentPrice').value = r.default_price || 0;
                    selectedLabel.innerText = `✓ เลือก: ห้อง ${r.room_number} (${r.room_type || ''}) • ${formatNumber(r.default_price)} ฿/เดือน`;
                    results.classList.add('hidden');
                });
                results.appendChild(div);
            });
            results.classList.remove('hidden');
        });

        document.addEventListener('click', function(e) {
            if (!input.contains(e.target) && !results.contains(e.target)) results.classList.add('hidden');
        });
    }

    // ==========================================
    // 4. Meter Toggles
    // ==========================================
    function setupMeterToggles() {
        const elecType = document.getElementById('elecChargeType');
        const waterType = document.getElementById('waterChargeType');

        if (elecType) {
            elecType.addEventListener('change', function() {
                if (this.value === 'flat_rate') {
                    const meter = document.getElementById('initialElecMeter');
                    if (meter) meter.value = 0;
                } else {
                    const flat = document.getElementById('elecFlatRate');
                    if (flat) flat.value = 0;
                }
                updateMeterBlocks('elecChargeType', 'elecPerUnitBlock', 'elecFlatRateBlock');
            });
        }

        if (waterType) {
            waterType.addEventListener('change', function() {
                if (this.value === 'flat_rate') {
                    const meter = document.getElementById('initialWaterMeter');
                    if (meter) meter.value = 0;
                } else {
                    const flat = document.getElementById('waterFlatRate');
                    if (flat) flat.value = 0;
                }
                updateMeterBlocks('waterChargeType', 'waterPerUnitBlock', 'waterFlatRateBlock');
            });
        }
    }

    // ==========================================
    // 5. Modal Add
    // ==========================================
    function openAddContractModal() {
        if (!getCurrentBuildingId()) { showNotification('⚠️ กรุณาเลือกอาคารก่อน', 'error'); return; }

        currentEditingContractId = null;
        selectedTenant = null;
        selectedRoom = null;

        document.getElementById('contractModalTitle').innerText = 'สร้างสัญญาใหม่';
        document.getElementById('contractForm').reset();
        document.getElementById('contractId').value = '';
        document.getElementById('tenantIdValue').value = '';
        document.getElementById('roomIdValue').value = '';
        document.getElementById('tenantSearch').value = '';
        document.getElementById('roomSearch').value = '';
        document.getElementById('tenantSelected').innerText = '';
        document.getElementById('roomSelected').innerText = '';
        document.getElementById('rentPrice').value = '';
        
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('startDate').value = today;
        
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 6);
        document.getElementById('endDate').value = endDate.toISOString().split('T')[0];
        
        document.getElementById('contractStatus').value = 'ACTIVE';
        document.getElementById('elecChargeType').value = 'per_unit';
        document.getElementById('waterChargeType').value = 'per_unit';
        document.getElementById('initialElecMeter').value = 0;
        document.getElementById('initialWaterMeter').value = 0;
        document.getElementById('elecFlatRate').value = 0;
        document.getElementById('waterFlatRate').value = 0;
        
        updateMeterBlocks('elecChargeType', 'elecPerUnitBlock', 'elecFlatRateBlock');
        updateMeterBlocks('waterChargeType', 'waterPerUnitBlock', 'waterFlatRateBlock');
        
        const modal = document.getElementById('contractModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    // ==========================================
    // 6. Modal Edit
    // ==========================================
    function openEditContractModal(contractId) {
        const contract = allContracts.find(c => Number(c.contract_id) === Number(contractId));
        if (!contract) { showNotification('⚠️ ไม่พบข้อมูลสัญญา', 'error'); return; }

        currentEditingContractId = Number(contractId);
        selectedTenant = { tenant_id: contract.tenant_id, first_name: contract.tenant_name, phone: contract.tenant_phone };
        selectedRoom = { room_id: contract.room_id, room_number: contract.room_number, room_type: contract.room_type };

        document.getElementById('contractModalTitle').innerText = `แก้ไขสัญญา #${contract.contract_id}`;
        document.getElementById('contractId').value = contract.contract_id;
        document.getElementById('tenantIdValue').value = contract.tenant_id;
        document.getElementById('roomIdValue').value = contract.room_id;
        document.getElementById('tenantSearch').value = contract.tenant_name || '';
        document.getElementById('roomSearch').value = contract.room_number || '';
        document.getElementById('tenantSelected').innerText = `✓ เลือก: ${contract.tenant_name}`;
        document.getElementById('roomSelected').innerText = `✓ เลือก: ห้อง ${contract.room_number} (${contract.room_type || ''})`;
        document.getElementById('startDate').value = contract.start_date || '';
        document.getElementById('endDate').value = contract.end_date || '';
        document.getElementById('rentPrice').value = contract.rent_price || '';
        document.getElementById('depositAmount').value = contract.deposit_amount || 0;
        document.getElementById('advanceRentAmount').value = contract.advance_rent_amount || 0;
        document.getElementById('initialElecMeter').value = contract.initial_elec_meter || 0;
        document.getElementById('initialWaterMeter').value = contract.initial_water_meter || 0;
        document.getElementById('elecChargeType').value = contract.elec_charge_type || 'per_unit';
        document.getElementById('waterChargeType').value = contract.water_charge_type || 'per_unit';
        document.getElementById('elecFlatRate').value = contract.elec_flat_rate || 0;
        document.getElementById('waterFlatRate').value = contract.water_flat_rate || 0;
        
        const normStatus = normalizeContractStatus(contract.status);
        document.getElementById('contractStatus').value = 
            (normStatus === 'TERMINATED') ? 'TERMINATED' 
            : 'ACTIVE';

        updateMeterBlocks('elecChargeType', 'elecPerUnitBlock', 'elecFlatRateBlock');
        updateMeterBlocks('waterChargeType', 'waterPerUnitBlock', 'waterFlatRateBlock');

        const modal = document.getElementById('contractModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeContractModal() {
        const modal = document.getElementById('contractModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        currentEditingContractId = null;
        selectedTenant = null;
        selectedRoom = null;
    }

    // ==========================================
    // 7. View Modal
    // ==========================================
    function openViewContractModal(contractId) {
        const c = allContracts.find(x => Number(x.contract_id) === Number(contractId));
        if (!c) { showNotification('⚠️ ไม่พบข้อมูลสัญญา', 'error'); return; }

        const contractNo = c.contract_number || `CT-${String(c.contract_id).padStart(5, '0')}`;
        document.getElementById('viewContractNumber').innerText = `สัญญา ${contractNo}`;
        document.getElementById('viewContractId').innerText = `Contract #${c.contract_id}`;

        document.getElementById('viewStatusBadge').innerHTML = getStatusBadge(getContractStatus(c));

        document.getElementById('viewTenantName').innerText = c.tenant_name || '-';
        document.getElementById('viewTenantPhone').innerText = c.tenant_phone || '-';
        document.getElementById('viewBuilding').innerText = c.building_name || '-';
        document.getElementById('viewRoom').innerText = c.room_number || '-';
        document.getElementById('viewRoomType').innerText = c.room_type || '-';

        document.getElementById('viewStartDate').innerText = formatDateLong(c.start_date);
        document.getElementById('viewEndDate').innerText = formatDateLong(c.end_date);
        
        if (c.end_date && getContractStatus(c) === 'active') {
            const minInfo = getMinPeriodInfo(c);
            let text = '-';
            if (minInfo.status === 'in_min_period') {
                text = `อีก ${minInfo.daysLeft} วันครบขั้นต่ำ`;
            } else if (minInfo.status === 'passed_min') {
                text = '✅ ครบขั้นต่ำแล้ว (อยู่ต่อได้)';
            }
            document.getElementById('viewDaysLeft').innerText = text;
        } else {
            document.getElementById('viewDaysLeft').innerText = '-';
        }

        document.getElementById('viewRentPrice').innerText = `${formatNumber(c.rent_price)} ฿`;
        document.getElementById('viewDeposit').innerText = `${formatNumber(c.deposit_amount)} ฿`;
        document.getElementById('viewAdvance').innerText = `${formatNumber(c.advance_rent_amount)} ฿`;

        let elecType = '📊 ต่อหน่วย';
        if (c.elec_charge_type === 'flat_rate') {
            elecType = `💰 เหมาจ่าย ${formatNumber(c.elec_flat_rate)} ฿/เดือน`;
        }
        let waterType = '📊 ต่อหน่วย';
        if (c.water_charge_type === 'flat_rate') {
            waterType = `💰 เหมาจ่าย ${formatNumber(c.water_flat_rate)} ฿/เดือน`;
        }
        document.getElementById('viewElecType').innerText = elecType;
        document.getElementById('viewWaterType').innerText = waterType;
        document.getElementById('viewElecMeter').innerText = c.initial_elec_meter ?? '-';
        document.getElementById('viewWaterMeter').innerText = c.initial_water_meter ?? '-';

        document.getElementById('viewEditBtn').onclick = function() {
            closeViewContractModal();
            setTimeout(() => openEditContractModal(Number(contractId)), 200);
        };

        const modal = document.getElementById('viewContractModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeViewContractModal() {
        const modal = document.getElementById('viewContractModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    // ==========================================
    // 8. บันทึก + ⭐ Validation
    // ==========================================
    async function saveContractData(e) {
        if (e) e.preventDefault();

        const btnText = document.getElementById('saveContractBtnText');
        const submitBtn = document.getElementById('saveContractBtn');
        
        const tenantId = document.getElementById('tenantIdValue').value;
        const roomId = document.getElementById('roomIdValue').value;
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const rentPrice = parseFloat(document.getElementById('rentPrice').value);
        const depositAmount = parseFloat(document.getElementById('depositAmount').value) || 0;
        const advanceRentAmount = parseFloat(document.getElementById('advanceRentAmount').value) || 0;
        const initialElecMeter = parseFloat(document.getElementById('initialElecMeter').value) || 0;
        const initialWaterMeter = parseFloat(document.getElementById('initialWaterMeter').value) || 0;
        const elecChargeType = document.getElementById('elecChargeType').value;
        const waterChargeType = document.getElementById('waterChargeType').value;
        const elecFlatRate = parseFloat(document.getElementById('elecFlatRate').value) || 0;
        const waterFlatRate = parseFloat(document.getElementById('waterFlatRate').value) || 0;
        const status = normalizeContractStatus(document.getElementById('contractStatus').value);

        // ⭐ Validation: required
        if (!tenantId) return showNotification('⚠️ กรุณาเลือกผู้เช่า', 'error');
        if (!roomId) return showNotification('⚠️ กรุณาเลือกห้อง', 'error');
        if (!startDate) return showNotification('⚠️ กรุณาเลือกวันเริ่มสัญญา', 'error');
        if (!endDate) return showNotification('⚠️ กรุณาเลือกวันครบสัญญาขั้นต่ำ', 'error');
        if (!rentPrice || rentPrice <= 0) return showNotification('⚠️ กรุณาเลือกห้องเพื่อกรอกค่าเช่า', 'error');

        // ⭐ Validation: จำนวนเงิน
        if (depositAmount < 0 || depositAmount > 99999999) {
            return showNotification('⚠️ เงินประกันต้องไม่เกิน 99,999,999 ฿', 'error');
        }
        if (rentPrice > 99999999) {
            return showNotification('⚠️ ค่าเช่าต้องไม่เกิน 99,999,999 ฿', 'error');
        }
        if (advanceRentAmount < 0 || advanceRentAmount > 99999999) {
            return showNotification('⚠️ ค่ามัดจำต้องไม่เกิน 99,999,999 ฿', 'error');
        }

        const isEdit = currentEditingContractId !== null;

        // ⭐ Validation: ห้ามผู้เช่าซ้ำ (เฉพาะตอนสร้างใหม่)
        if (!isEdit) {
            const activeTenantIds = getActiveTenantIds();
            if (activeTenantIds.has(Number(tenantId))) {
                return showNotification('⚠️ ผู้เช่ารายนี้มีสัญญา ACTIVE อยู่แล้ว', 'error');
            }
            const activeRoomIds = getActiveRoomIds();
            if (activeRoomIds.has(Number(roomId))) {
                return showNotification('⚠️ ห้องนี้มีผู้เช่าอยู่แล้ว (มีสัญญา ACTIVE)', 'error');
            }
        }

        btnText.innerText = 'กำลังบันทึก...';
        submitBtn.disabled = true;

        try {
            const endpoint = isEdit ? `${API_BASE}/contracts-update` : `${API_BASE}/contracts-create`;
            
            const payload = {
                tenant_id: parseInt(tenantId),
                room_id: parseInt(roomId),
                start_date: startDate,
                end_date: endDate,
                rent_price: rentPrice,
                deposit_amount: depositAmount,
                advance_rent_amount: advanceRentAmount,
                initial_elec_meter: initialElecMeter,
                initial_water_meter: initialWaterMeter,
                elec_charge_type: elecChargeType,
                water_charge_type: waterChargeType,
                elec_flat_rate: elecFlatRate,
                water_flat_rate: waterFlatRate,
                status: status
            };

            if (isEdit) payload.contract_id = currentEditingContractId;
            else payload.building_id = parseInt(getCurrentBuildingId());

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const text = await response.text();
            let raw = null;
            try { raw = text ? JSON.parse(text) : null; } catch(_) {}
            const result = extractResult(raw);

            if (response.ok && result.success === true) {
                closeContractModal();
                showNotification(isEdit ? '✅ แก้ไขสัญญาสำเร็จ!' : '✅ สร้างสัญญาสำเร็จ!', 'success');
                setTimeout(async () => { await loadContracts(); }, 500);
            } else {
                throw new Error(result.message || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ บันทึกสัญญาล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btnText.innerText = 'บันทึก';
            submitBtn.disabled = false;
        }
    }

    // ==========================================
    // 9. Delete
    // ==========================================
    function openDeleteContractModal(contractId, tenantName) {
        deletingContractId = contractId;
        document.getElementById('deleteContractName').innerText = tenantName || 'ไม่ระบุ';
        const modal = document.getElementById('deleteContractModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeDeleteContractModal() {
        const modal = document.getElementById('deleteContractModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        deletingContractId = null;
    }

    async function confirmDeleteContract() {
        if (!deletingContractId) return;

        const btn = document.getElementById('confirmDeleteContractBtn');
        btn.disabled = true;
        btn.innerText = 'กำลังจบสัญญา...';

        try {
            const response = await fetch(`${API_BASE}/contracts-delete?id=${deletingContractId}`, { method: 'DELETE' });
            const text = await response.text();

            if (!text || text.trim() === '' || text === '[]') {
                await new Promise(r => setTimeout(r, 800));
                await loadContracts();
                closeDeleteContractModal();
                showNotification('🔴 จบสัญญาสำเร็จ (เก็บในทะเบียน)', 'success');
                return;
            }

            let raw = null;
            try { raw = JSON.parse(text); } catch(e) { throw new Error('Response ไม่ใช่ JSON'); }
            const result = extractResult(raw);

            if (response.ok && result.success === true) {
                closeDeleteContractModal();
                showNotification('🔴 จบสัญญาสำเร็จ (เก็บในทะเบียน)', 'success');
                setTimeout(async () => { await loadContracts(); }, 500);
            } else {
                throw new Error(result.message || 'ไม่สามารถจบสัญญาได้');
            }
        } catch (error) {
            console.error('❌ ล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerText = 'ยืนยันจบสัญญา';
        }
    }

    // ==========================================
    // 10. Filters
    // ==========================================
    function setupFilters() {
        const statusFilter = document.getElementById('statusFilter');
        const search = document.getElementById('searchContract');
        
        if (statusFilter) statusFilter.addEventListener('change', renderContracts);
        if (search) {
            search.addEventListener('input', () => {
                clearTimeout(window._contractSearchTimer);
                window._contractSearchTimer = setTimeout(renderContracts, 200);
            });
        }
    }

    // ==========================================
    // 11. Export
    // ==========================================
    window.openAddContractModal = openAddContractModal;
    window.openEditContractModal = openEditContractModal;
    window.closeContractModal = closeContractModal;
    window.openViewContractModal = openViewContractModal;
    window.closeViewContractModal = closeViewContractModal;
    window.openDeleteContractModal = openDeleteContractModal;
    window.closeDeleteContractModal = closeDeleteContractModal;
    window.loadContracts = loadContracts;

    // ==========================================
    // 12. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 contracts.js v8 เริ่มทำงาน');
        setTimeout(() => { loadContracts(); }, 300);

        const form = document.getElementById('contractForm');
        if (form) form.addEventListener('submit', saveContractData);

        const confirmBtn = document.getElementById('confirmDeleteContractBtn');
        if (confirmBtn) confirmBtn.addEventListener('click', confirmDeleteContract);

        setupFilters();
        setupTenantSearch();
        setupRoomSearch();
        setupMeterToggles();

        window.addEventListener('buildingChanged', () => loadContracts());
        
        lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const currentId = getCurrentBuildingId();
            if (currentId !== lastBuildingId) {
                lastBuildingId = currentId;
                loadContracts();
            }
        }, 1000);

        console.log('✅ contracts.js v8 โหลดสำเร็จ');
    });

})();
