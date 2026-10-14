/* ==========================================
 * transfer.js - แจ้งย้ายห้อง (v6)
 * ⭐ v6:
 *   - Modal ยืนยันก่อนอนุมัติ
 *   - เช็คบิลค้างของสัญญาเดิม (block ถ้ามี)
 *   - แสดงวันครบสัญญาเดิม
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'https://n8n_mirot.minmark.xyz/webhook';

    let allTransfers = [];
    let tenantsList = [];
    let roomsList = [];
    let lastBuildingId = '';
    let isLoading = false;
    let pendingApproveId = null;

    const showNotification = window.showNotification;
    const escapeHtml = window.escapeHtml;
    const formatNumber = window.formatNumber;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

    // ==========================================
    // Helpers
    // ==========================================
    function normalizeStatus(status) {
        if (status === null || status === undefined) return '';
        const s = String(status).trim().toUpperCase();
        if (s === '') return '';
        if (s === 'VACANT') return 'AVAILABLE';
        if (s === 'AVAILABLE') return 'AVAILABLE';
        if (s === 'OCCUPIED') return 'OCCUPIED';
        if (s === 'BOOKED') return 'BOOKED';
        if (s === 'MAINTENANCE' || s === 'REPAIR') return 'MAINTENANCE';
        return s;
    }

    function isRoomAvailable(status) {
        return normalizeStatus(status) === 'AVAILABLE';
    }

    function isPaidValue(v) {
        return v === true || v === 'true' || v === 1 || v === '1';
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

    function getStatusBadge(status) {
        const s = String(status || '').toUpperCase();
        const badges = {
            'PENDING':   { label: 'รออนุมัติ',   cls: 'bg-yellow-100 text-yellow-700', icon: '🟡' },
            'APPROVED':  { label: 'อนุมัติแล้ว',  cls: 'bg-green-100 text-green-700',   icon: '🟢' },
            'CANCELLED': { label: 'ยกเลิก',      cls: 'bg-red-100 text-red-700',       icon: '🔴' },
            'REJECTED':  { label: 'ปฏิเสธ',      cls: 'bg-red-100 text-red-700',       icon: '🔴' }
        };
        const cfg = badges[s] || badges['PENDING'];
        return `<span class="px-2.5 py-1 ${cfg.cls} rounded-full text-xs font-medium inline-block whitespace-nowrap">${cfg.icon} ${cfg.label}</span>`;
    }

    // ==========================================
    // 1. โหลดรายการ
    // ==========================================
    async function loadTransfers() {
        const tbody = document.getElementById('transferTableBody');
        if (!tbody || isLoading) return;
        isLoading = true;
        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">กำลังโหลด...</td></tr>';

        try {
            const buildingId = getCurrentBuildingId();
            if (!buildingId) {
                tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">กรุณาเลือกอาคาร</td></tr>';
                isLoading = false;
                return;
            }

            const url = `${API_BASE}/transfers?_t=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            allTransfers = toArray(parsed).filter(t => t.is_deleted !== true && t.is_deleted !== 'true');
            
            renderTransfers();
            
            const subtitle = document.getElementById('transferSubtitle');
            if (subtitle) subtitle.innerText = `ประวัติใน ${getCurrentBuildingName() || 'อาคารปัจจุบัน'}`;
        } catch (error) {
            console.error('❌ โหลดล้มเหลว:', error);
            tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-red-500">⚠️ ${escapeHtml(error.message)}</td></tr>`;
        } finally {
            isLoading = false;
        }
    }

    // ==========================================
    // 2. Render
    // ==========================================
    function renderTransfers() {
        const tbody = document.getElementById('transferTableBody');
        if (!tbody) return;
        
        const buildingId = getCurrentBuildingId();
        const statusFilter = String(document.getElementById('statusFilter')?.value || '').toUpperCase();
        const searchQuery = (document.getElementById('searchTransfer')?.value || '').trim().toLowerCase();

        let filtered = allTransfers.filter(t => {
            const tStatus = String(t.status || '').toUpperCase();
            if (buildingId && t.building_id && Number(t.building_id) !== Number(buildingId)) return false;
            if (statusFilter && tStatus !== statusFilter) return false;
            if (searchQuery) {
                const name = String(t.tenant_name || '').toLowerCase();
                const from = String(t.from_room_number || '').toLowerCase();
                const to = String(t.to_room_number || '').toLowerCase();
                const no = String(t.transfer_no || '').toLowerCase();
                if (!name.includes(searchQuery) && !from.includes(searchQuery) && !to.includes(searchQuery) && !no.includes(searchQuery)) return false;
            }
            return true;
        });

        filtered.sort((a, b) => (b.id || 0) - (a.id || 0));

        const countEl = document.getElementById('transferCount');
        if (countEl) countEl.innerText = filtered.length;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">
                ${allTransfers.length === 0 ? 'ยังไม่มีประวัติการย้ายห้อง' : 'ไม่พบรายการที่ตรงกับเงื่อนไข'}
            </td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(t => {
            const tStatus = String(t.status || '').toUpperCase();
            const isPending = tStatus === 'PENDING';
            
            let actionButtons = '';
            if (isPending) {
                actionButtons = `
                    <button data-approve-id="${t.id}" class="js-approve bg-green-600 hover:bg-green-700 text-white px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1" title="อนุมัติ">✅ อนุมัติ</button>
                    <button data-cancel-id="${t.id}" class="js-cancel bg-red-100 hover:bg-red-200 text-red-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1" title="ยกเลิก">❌ ยกเลิก</button>
                `;
            }
            
            const infoButtons = `
                <button data-view-id="${t.id}" class="js-view bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1.5 rounded-md text-xs font-medium transition mr-1" title="ดู">👁️</button>
                <button data-delete-id="${t.id}" class="js-delete bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1.5 rounded-md text-xs font-medium transition" title="ลบ">🗑️</button>
            `;

            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition';
            tr.innerHTML = `
                <td class="px-4 py-3"><span class="font-bold text-blue-700 text-sm">${escapeHtml(t.transfer_no || '-')}</span></td>
                <td class="px-4 py-3">
                    <div class="font-medium text-gray-800">${escapeHtml(t.tenant_name || '-')}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(t.tenant_phone || '')}</div>
                </td>
                <td class="px-4 py-3 text-gray-500 line-through">${escapeHtml(t.from_room_number || '-')}</td>
                <td class="px-4 py-3 font-bold text-green-600">${escapeHtml(t.to_room_number || '-')}</td>
                <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${formatDate(t.transfer_date)}</td>
                <td class="px-4 py-3">${getStatusBadge(t.status)}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">${actionButtons}${infoButtons}</td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.js-approve').forEach(btn => {
            btn.addEventListener('click', function() { openApproveModal(parseInt(this.getAttribute('data-approve-id'))); });
        });
        tbody.querySelectorAll('.js-cancel').forEach(btn => {
            btn.addEventListener('click', function() { cancelTransfer(parseInt(this.getAttribute('data-cancel-id'))); });
        });
        tbody.querySelectorAll('.js-view').forEach(btn => {
            btn.addEventListener('click', function() { openViewModal(parseInt(this.getAttribute('data-view-id'))); });
        });
        tbody.querySelectorAll('.js-delete').forEach(btn => {
            btn.addEventListener('click', function() { deleteTransfer(parseInt(this.getAttribute('data-delete-id'))); });
        });
    }

    // ==========================================
    // 3. Dropdown data
    // ==========================================
    async function loadTransferData() {
        const tenantSelect = document.getElementById('tenantSelect');
        const roomSelect = document.getElementById('roomSelect');
        tenantSelect.innerHTML = '<option value="">-- กำลังโหลด --</option>';
        roomSelect.innerHTML = '<option value="">-- รอโหลด --</option>';
        roomSelect.disabled = true;

        try {
            const buildingId = getCurrentBuildingId();
            const url = `${API_BASE}/transfer-data?building_id=${buildingId}&_t=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store' });
            const data = await res.json();
            const payload = Array.isArray(data) ? data[0] : data;

            let tenants = payload.tenants || [];
            let rooms = payload.rooms || [];
            if (!Array.isArray(tenants)) tenants = tenants && Object.keys(tenants).length ? [tenants] : [];
            if (!Array.isArray(rooms)) rooms = rooms && Object.keys(rooms).length ? [rooms] : [];

            const seenT = new Set();
            tenants = tenants.filter(t => {
                if (!t || !t.tenant_id) return false;
                if (seenT.has(t.tenant_id)) return false;
                seenT.add(t.tenant_id);
                return true;
            });

            const seenR = new Set();
            rooms = rooms.filter(r => {
                if (!r || !r.room_id) return false;
                if (seenR.has(r.room_id)) return false;
                seenR.add(r.room_id);
                return true;
            });

            tenantsList = tenants;
            roomsList = rooms;

            tenantSelect.innerHTML = '<option value="">-- เลือกผู้เช่า --</option>';
            tenantsList.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.tenant_id;
                opt.textContent = `${t.tenant_name} (${t.tenant_phone || '-'}) — ห้อง ${t.room_number}`;
                opt.dataset.contractId = t.contract_id;
                opt.dataset.roomId = t.room_id;
                opt.dataset.roomNumber = t.room_number;
                opt.dataset.rentPrice = t.rent_price || 0;
                opt.dataset.deposit = t.deposit_amount || 0;
                opt.dataset.advance = t.advance_rent_amount || 0;
                tenantSelect.appendChild(opt);
            });

            if (tenantsList.length === 0) {
                tenantSelect.innerHTML = '<option value="">-- ไม่มีผู้เช่าที่มีสัญญา ACTIVE --</option>';
            }
        } catch (err) {
            console.error('❌ โหลดข้อมูลล้มเหลว:', err);
            tenantSelect.innerHTML = '<option value="">-- โหลดไม่สำเร็จ --</option>';
            showNotification('❌ โหลดข้อมูลไม่สำเร็จ', 'error');
        }
    }

    // ==========================================
    // 4. Modal Create
    // ==========================================
    async function openCreateModal() {
        document.getElementById('transferForm').reset();
        document.getElementById('currentInfo').classList.add('hidden');
        document.getElementById('roomSelect').disabled = true;
        document.getElementById('roomSelect').innerHTML = '<option value="">-- เลือกผู้เช่าก่อน --</option>';
        document.getElementById('transferDate').value = new Date().toISOString().split('T')[0];

        const modal = document.getElementById('createModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        await loadTransferData();
    }

    function closeCreateModal() {
        const modal = document.getElementById('createModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    function onTenantChange(e) {
        const opt = e.target.selectedOptions[0];
        const infoBox = document.getElementById('currentInfo');
        const roomSelect = document.getElementById('roomSelect');

        if (!opt || !opt.value) {
            infoBox.classList.add('hidden');
            roomSelect.disabled = true;
            roomSelect.innerHTML = '<option value="">-- เลือกผู้เช่าก่อน --</option>';
            return;
        }

        const currentRoomId = parseInt(opt.dataset.roomId);

        document.getElementById('currentRoom').innerText = opt.dataset.roomNumber;
        document.getElementById('currentRent').innerText = formatNumber(opt.dataset.rentPrice) + ' ฿';
        document.getElementById('currentDeposit').innerText = formatNumber(opt.dataset.deposit) + ' ฿';
        document.getElementById('newRent').value = opt.dataset.rentPrice || '';
        document.getElementById('newDeposit').value = opt.dataset.deposit || '';
        document.getElementById('newAdvance').value = opt.dataset.advance || '';
        infoBox.classList.remove('hidden');

        const availableRooms = roomsList
            .filter(r => Number(r.room_id) !== Number(currentRoomId))
            .filter(r => isRoomAvailable(r.status));

        roomSelect.disabled = false;
        roomSelect.innerHTML = '<option value="">-- เลือกห้องใหม่ --</option>';

        if (availableRooms.length === 0) {
            roomSelect.innerHTML = '<option value="">-- ไม่มีห้องว่าง --</option>';
            roomSelect.disabled = true;
            return;
        }

        availableRooms.forEach(r => {
            const o = document.createElement('option');
            o.value = r.room_id;
            o.textContent = `ห้อง ${r.room_number} • ${r.room_type || '-'} • ${formatNumber(r.default_price)} ฿`;
            o.dataset.defaultPrice = r.default_price;
            roomSelect.appendChild(o);
        });
    }

    function onRoomChange(e) {
        const opt = e.target.selectedOptions[0];
        if (!opt || !opt.value) return;
        document.getElementById('newRent').value = opt.dataset.defaultPrice || '';
    }

    // ==========================================
    // 5. Save (บันทึกคำร้อง)
    // ==========================================
    async function saveTransfer(e) {
        e.preventDefault();

        const btn = document.getElementById('saveTransferBtn');
        const btnText = document.getElementById('saveTransferBtnText');

        const tenantId = parseInt(document.getElementById('tenantSelect').value);
        const toRoomId = parseInt(document.getElementById('roomSelect').value);
        const transferDate = document.getElementById('transferDate').value;
        const reason = document.getElementById('transferReason').value.trim();
        const note = document.getElementById('transferNote').value.trim();
        const rentPrice = parseFloat(document.getElementById('newRent').value) || null;
        const deposit = parseFloat(document.getElementById('newDeposit').value) || null;
        const advance = parseFloat(document.getElementById('newAdvance').value) || null;

        if (!tenantId) return showNotification('⚠️ กรุณาเลือกผู้เช่า', 'error');
        if (!toRoomId) return showNotification('⚠️ กรุณาเลือกห้องใหม่', 'error');
        if (!transferDate) return showNotification('⚠️ กรุณาเลือกวันที่ย้าย', 'error');

        if (!confirm('⚠️ ยืนยันการแจ้งย้ายห้อง?\n\nระบบจะบันทึกคำร้อง (รออนุมัติ)\nยังไม่ย้ายจริงจนกว่าจะกดอนุมัติ')) return;

        btn.disabled = true;
        btnText.innerText = 'กำลังบันทึก...';

        try {
            const payload = {
                tenant_id: tenantId,
                to_room_id: toRoomId,
                transfer_date: transferDate,
                reason: reason || null,
                note: note || null,
                rent_price: rentPrice,
                deposit_amount: deposit,
                advance_rent_amount: advance,
                created_by: localStorage.getItem('admin_username') || 'admin'
            };

            const res = await fetch(`${API_BASE}/transfers-create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const text = await res.text();
            const raw = text ? JSON.parse(text) : null;
            const result = extractResult(raw);

            if (res.ok && result.success === true) {
                closeCreateModal();
                showNotification('✅ แจ้งย้ายห้องสำเร็จ (รออนุมัติ)', 'success');
                setTimeout(() => loadTransfers(), 500);
            } else {
                throw new Error(result.message || `HTTP ${res.status}`);
            }
        } catch (err) {
            console.error('❌ บันทึกล้มเหลว:', err);
            showNotification('❌ ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btnText.innerText = '✅ ยืนยันการแจ้ง';
        }
    }

    // ==========================================
    // ⭐ 6. Approve — เปิด Modal ยืนยัน + เช็คบิล
    // ==========================================
    async function openApproveModal(requestId) {
        const t = allTransfers.find(x => Number(x.id) === Number(requestId));
        if (!t) { showNotification('⚠️ ไม่พบข้อมูล', 'error'); return; }

        pendingApproveId = requestId;

        // เตรียม modal
        const modal = document.getElementById('approveModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // แสดงข้อมูลพื้นฐาน
        document.getElementById('approveTransferNo').innerText = t.transfer_no || `#${t.id}`;
        document.getElementById('approveTenantName').innerText = t.tenant_name || '-';
        document.getElementById('approveFromRoom').innerText = t.from_room_number || '-';
        document.getElementById('approveToRoom').innerText = t.to_room_number || '-';
        document.getElementById('approveContractEnd').innerText = '⏳ กำลังโหลด...';

        const billBox = document.getElementById('approveBillCheck');
        billBox.innerHTML = '<div class="bg-gray-50 rounded-lg p-4 text-center text-gray-500 text-sm">⏳ กำลังตรวจสอบบิลค้างชำระ...</div>';

        const confirmBtn = document.getElementById('approveConfirmBtn');
        confirmBtn.disabled = true;
        document.getElementById('approveConfirmBtnText').innerText = '⏳ กำลังตรวจสอบ...';

        // โหลดข้อมูล
        try {
            const buildingId = getCurrentBuildingId();
            const [contractsRes, invoicesRes] = await Promise.all([
                fetch(`${API_BASE}/contracts?building_id=${buildingId}&_t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()).catch(() => []),
                fetch(`${API_BASE}/invoices?building_id=${buildingId}&_t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()).catch(() => [])
            ]);

            const contractArr = toArray(contractsRes).filter(c => c.is_deleted !== true && c.is_deleted !== 'true');
            const invoiceArr = toArray(invoicesRes).filter(i => i.is_deleted !== true && i.is_deleted !== 'true');

            // หาสัญญาเดิม (ACTIVE + tenant match + room match)
            const oldContract = contractArr.find(c =>
                Number(c.tenant_id) === Number(t.tenant_id) &&
                String(c.status || '').toUpperCase() === 'ACTIVE'
            );

            // แสดงวันครบสัญญา
            if (oldContract && oldContract.end_date) {
                document.getElementById('approveContractEnd').innerText = formatDateLong(oldContract.end_date);
                document.getElementById('approveContractEnd').classList.add('text-blue-700', 'font-bold');
            } else if (oldContract) {
                document.getElementById('approveContractEnd').innerText = '(ไม่ระบุ)';
            } else {
                document.getElementById('approveContractEnd').innerText = '⚠️ ไม่พบสัญญา ACTIVE';
            }

            // หาบิลค้าง (filter by contract_id)
            let unpaidBills = [];
            if (oldContract) {
                unpaidBills = invoiceArr.filter(inv =>
                    Number(inv.contract_id) === Number(oldContract.contract_id) &&
                    !isPaidValue(inv.is_paid)
                );
            }

            // Render check result
            if (!oldContract) {
                billBox.innerHTML = `
                    <div class="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4">
                        <p class="font-bold text-yellow-800 mb-1">⚠️ ไม่พบสัญญา ACTIVE</p>
                        <p class="text-xs text-yellow-700">ไม่สามารถอนุมัติได้ กรุณาตรวจสอบข้อมูลสัญญาก่อน</p>
                    </div>
                `;
                document.getElementById('approveConfirmBtnText').innerText = '❌ ไม่สามารถอนุมัติ';
                confirmBtn.disabled = true;
            } else if (unpaidBills.length > 0) {
                const totalUnpaid = unpaidBills.reduce((s, inv) => s + (parseFloat(inv.total_amount) || 0), 0);
                const billsHtml = unpaidBills.slice(0, 5).map(inv => `
                    <div class="flex justify-between text-xs py-1 border-b border-red-200 last:border-0">
                        <span>${escapeHtml(inv.vol_no || '-')} • ${escapeHtml(inv.billing_month || '-')}</span>
                        <span class="font-bold text-red-700">${formatNumber(inv.total_amount)} ฿</span>
                    </div>
                `).join('');

                billBox.innerHTML = `
                    <div class="bg-red-50 border-2 border-red-300 rounded-lg p-4">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="text-2xl">⛔</span>
                            <div>
                                <p class="font-bold text-red-800">พบบิลค้างชำระ ${unpaidBills.length} รายการ</p>
                                <p class="text-xs text-red-600">ยอดรวม <strong>${formatNumber(totalUnpaid)} ฿</strong> — ต้องเคลียร์ก่อนอนุมัติ</p>
                            </div>
                        </div>
                        <div class="bg-white rounded p-2 mt-2 mb-3">
                            ${billsHtml}
                            ${unpaidBills.length > 5 ? `<p class="text-xs text-gray-500 text-center pt-1">...และอีก ${unpaidBills.length - 5} รายการ</p>` : ''}
                        </div>
                        <a href="payments.html" class="block text-center bg-red-600 hover:bg-red-700 text-white font-medium py-2 rounded-lg transition text-sm">
                            💲 ไปที่หน้าตรวจสอบการชำระเงิน
                        </a>
                    </div>
                `;
                confirmBtn.disabled = true;
                document.getElementById('approveConfirmBtnText').innerText = '❌ ต้องเคลียร์บิลก่อน';
            } else {
                billBox.innerHTML = `
                    <div class="bg-green-50 border-2 border-green-300 rounded-lg p-4 flex items-center gap-3">
                        <span class="text-2xl">✅</span>
                        <div>
                            <p class="font-bold text-green-800">เคลียร์บิลครบแล้ว</p>
                            <p class="text-xs text-green-700">ไม่มีบิลค้างชำระ สามารถอนุมัติได้ทันที</p>
                        </div>
                    </div>
                `;
                confirmBtn.disabled = false;
                document.getElementById('approveConfirmBtnText').innerText = '✅ ยืนยันอนุมัติ';
            }
        } catch (err) {
            console.error('❌ ตรวจสอบล้มเหลว:', err);
            billBox.innerHTML = `
                <div class="bg-red-50 border-2 border-red-300 rounded-lg p-4">
                    <p class="font-bold text-red-800">❌ ตรวจสอบไม่สำเร็จ</p>
                    <p class="text-xs text-red-700">${escapeHtml(err.message)}</p>
                </div>
            `;
            confirmBtn.disabled = true;
            document.getElementById('approveConfirmBtnText').innerText = '❌ ลองใหม่';
        }
    }

    function closeApproveModal() {
        const modal = document.getElementById('approveModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        pendingApproveId = null;
    }

    async function confirmApprove() {
        if (!pendingApproveId) return;

        const btn = document.getElementById('approveConfirmBtn');
        const btnText = document.getElementById('approveConfirmBtnText');
        btn.disabled = true;
        btnText.innerText = '⏳ กำลังอนุมัติ...';

        const processedBy = localStorage.getItem('admin_username') || 'admin';

        try {
            const res = await fetch(`${API_BASE}/transfers-approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request_id: pendingApproveId, approved_by: processedBy })
            });
            const text = await res.text();
            const raw = text ? JSON.parse(text) : null;
            const result = extractResult(raw);

            if (res.ok && result.success === true) {
                closeApproveModal();
                showNotification('✅ อนุมัติย้ายห้องสำเร็จ', 'success');
                setTimeout(() => loadTransfers(), 500);
            } else {
                throw new Error(result.message || 'ไม่สำเร็จ');
            }
        } catch (err) {
            console.error('❌ approve failed:', err);
            showNotification('❌ ' + err.message, 'error');
            btn.disabled = false;
            btnText.innerText = '✅ ยืนยันอนุมัติ';
        }
    }

    // ==========================================
    // 7. Cancel
    // ==========================================
    async function cancelTransfer(requestId) {
        const reason = prompt('❌ เหตุผลที่ยกเลิก (ถ้าไม่มี กด OK):');
        if (reason === null) return;

        const processedBy = localStorage.getItem('admin_username') || 'admin';

        try {
            const res = await fetch(`${API_BASE}/transfers-cancel`, {
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
                setTimeout(() => loadTransfers(), 500);
            } else {
                throw new Error(result.message || 'ไม่สำเร็จ');
            }
        } catch (err) {
            console.error('❌ cancel failed:', err);
            showNotification('❌ ' + err.message, 'error');
        }
    }

    // ==========================================
    // 8. View Modal
    // ==========================================
    function openViewModal(id) {
        const t = allTransfers.find(x => Number(x.id) === Number(id));
        if (!t) return;

        document.getElementById('viewTransferNo').innerText = t.transfer_no || '-';
        document.getElementById('viewTransferDate').innerText = formatDateLong(t.transfer_date);
        document.getElementById('viewStatusBadge').innerHTML = getStatusBadge(t.status);
        document.getElementById('viewTenantName').innerText = t.tenant_name || '-';
        document.getElementById('viewTenantPhone').innerText = t.tenant_phone || '-';
        document.getElementById('viewFromRoom').innerText = t.from_room_number || '-';
        document.getElementById('viewToRoom').innerText = t.to_room_number || '-';

        const reasonWrap = document.getElementById('viewReasonWrap');
        if (t.reason) {
            document.getElementById('viewReason').innerText = t.reason;
            reasonWrap.classList.remove('hidden');
        } else reasonWrap.classList.add('hidden');

        const noteWrap = document.getElementById('viewNoteWrap');
        if (t.note) {
            document.getElementById('viewNote').innerText = t.note;
            noteWrap.classList.remove('hidden');
        } else noteWrap.classList.add('hidden');

        document.getElementById('viewDeleteBtn').onclick = () => {
            if (confirm('⚠️ ลบรายการย้ายห้องนี้?')) {
                closeViewModal();
                deleteTransfer(t.id);
            }
        };

        const modal = document.getElementById('viewModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeViewModal() {
        const modal = document.getElementById('viewModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    // ==========================================
    // 9. Delete
    // ==========================================
    async function deleteTransfer(id) {
        if (!confirm('⚠️ ลบรายการย้ายห้องนี้?\n\n(ประวัติจะยังอยู่ในฐานข้อมูล)')) return;

        try {
            const res = await fetch(`${API_BASE}/transfers-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            const text = await res.text();

            if (res.ok && (!text || text.trim() === '' || text === '[]')) {
                await new Promise(r => setTimeout(r, 500));
                await loadTransfers();
                showNotification('🗑️ ลบสำเร็จ', 'success');
                return;
            }

            let raw = null;
            try { raw = text ? JSON.parse(text) : null; } catch(_) {}
            const result = extractResult(raw);

            if (res.ok && result.success === true) {
                showNotification('🗑️ ลบสำเร็จ', 'success');
                setTimeout(() => loadTransfers(), 500);
            } else {
                throw new Error(result.message || 'ไม่สำเร็จ');
            }
        } catch (err) {
            console.error('❌ ลบล้มเหลว:', err);
            showNotification('❌ ' + err.message, 'error');
        }
    }

    // ==========================================
    // 10. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 transfer.js v6 เริ่มทำงาน (approve modal + check bills)');
        setTimeout(() => loadTransfers(), 300);

        document.getElementById('transferForm').addEventListener('submit', saveTransfer);
        document.getElementById('tenantSelect').addEventListener('change', onTenantChange);
        document.getElementById('roomSelect').addEventListener('change', onRoomChange);

        document.getElementById('statusFilter').addEventListener('change', renderTransfers);
        document.getElementById('searchTransfer').addEventListener('input', () => {
            clearTimeout(window._trTimer);
            window._trTimer = setTimeout(renderTransfers, 200);
        });

        document.getElementById('approveConfirmBtn').addEventListener('click', confirmApprove);

        window.addEventListener('buildingChanged', () => loadTransfers());

        lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const cur = getCurrentBuildingId();
            if (cur !== lastBuildingId) {
                lastBuildingId = cur;
                loadTransfers();
            }
        }, 1000);

        window.openCreateModal = openCreateModal;
        window.closeCreateModal = closeCreateModal;
        window.closeViewModal = closeViewModal;
        window.closeApproveModal = closeApproveModal;
        window.deleteTransfer = deleteTransfer;
        window.openApproveModal = openApproveModal;
        window.cancelTransfer = cancelTransfer;
        window.loadTransfers = loadTransfers;
    });

})();
