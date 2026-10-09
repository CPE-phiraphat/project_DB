/* ==========================================
 * bookings.js - จัดการรายการจองห้อง (v5.1)
 * ⭐ v5.1: แก้ bug normalizeStatus('') คืน ''
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'http://n8n_mirot.minmark.xyz/webhook';

    let allBookings = [];
    let availableRooms = [];
    let currentEditingBookingId = null;
    let deletingBookingId = null;
    let deletingBookingName = '';
    let lastBuildingId = '';
    let isLoading = false;

    const showNotification = window.showNotification;
    const escapeHtml = window.escapeHtml;
    const formatNumber = window.formatNumber;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

    // ==========================================
    // ⭐ Helper: Normalize Status (แก้บั๊กแล้ว)
    // ==========================================
    function normalizeStatus(s) {
        return String(s || '').trim().toUpperCase();
    }

    // ⭐ คืน '' ถ้า input ว่างเปล่า (สำคัญมากสำหรับ filter "ทุกสถานะ")
    function normalizeBookingStatus(s) {
        if (s === null || s === undefined) return '';
        const u = String(s).trim().toUpperCase();
        if (u === '') return '';
        if (u === 'PENDING' || u === 'WAITING') return 'PENDING';
        if (u === 'APPROVED' || u === 'CONFIRMED') return 'APPROVED';
        if (u === 'COMPLETED' || u === 'CHECKED_IN' || u === 'DONE') return 'COMPLETED';
        if (u === 'CANCELLED' || u === 'CANCELED') return 'CANCELLED';
        if (u === 'EXPIRED') return 'EXPIRED';
        return u;
    }

    function normalizeRoomStatus(s) {
        const u = normalizeStatus(s);
        if (u === 'VACANT') return 'AVAILABLE';
        if (u === 'REPAIR') return 'MAINTENANCE';
        return u;
    }

    const STATUS_CONFIG = {
        'PENDING':   { label: 'รอตรวจสอบสลิป',          bg: 'bg-yellow-100', text: 'text-yellow-700', icon: '🟡' },
        'APPROVED':  { label: 'อนุมัติแล้ว (รอสัญญา)',   bg: 'bg-blue-100',   text: 'text-blue-700',   icon: '🔵' },
        'COMPLETED': { label: 'ทำสัญญาแล้ว',             bg: 'bg-green-100',  text: 'text-green-700',  icon: '🟢' },
        'CANCELLED': { label: 'ยกเลิก',                  bg: 'bg-red-100',    text: 'text-red-700',    icon: '🔴' },
        'EXPIRED':   { label: 'หมดอายุ (ไม่มาทำสัญญา)',  bg: 'bg-gray-200',   text: 'text-gray-700',   icon: '⚫' }
    };

    function getStatusBadge(status) {
        const key = normalizeBookingStatus(status);
        const cfg = STATUS_CONFIG[key] || { label: key || '-', bg: 'bg-gray-100', text: 'text-gray-700', icon: '⚪' };
        return `<span class="px-2.5 py-1 ${cfg.bg} ${cfg.text} rounded-full text-xs font-medium inline-block whitespace-nowrap">${cfg.icon} ${cfg.label}</span>`;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch { return dateStr; }
    }

    // ==========================================
    // 1. โหลดรายการจอง
    // ==========================================
    async function loadBookings() {
        const tbody = document.getElementById('bookingTableBody');
        if (!tbody) return;

        if (isLoading) {
            console.log('⏳ กำลังโหลดอยู่ — ข้ามรอบนี้');
            return;
        }
        isLoading = true;

        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">กำลังโหลดข้อมูล...</td></tr>';

        try {
            const buildingId = getCurrentBuildingId();
            if (!buildingId) {
                tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">กรุณาเลือกอาคารก่อน</td></tr>';
                isLoading = false;
                return;
            }

            const timestamp = Date.now();
            const url = `${API_BASE}/bookings?building_id=${buildingId}&_t=${timestamp}`;
            console.log('🌐 โหลดรายการจอง:', url);

            const response = await fetch(url, {
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            let bookings = toArray(parsed);
            
            allBookings = bookings.filter(b => b.is_deleted !== true && b.is_deleted !== 'true');
            
            allBookings = allBookings.map(b => ({
                ...b,
                status: normalizeBookingStatus(b.status)
            }));
            
            console.log(`📦 โหลด ${bookings.length} รายการ → แสดง ${allBookings.length}`);
            
            renderBookings();
            
            const subtitle = document.getElementById('bookingSubtitle');
            if (subtitle) {
                subtitle.innerText = `รายการจองของ ${getCurrentBuildingName() || 'อาคารปัจจุบัน'}`;
            }
            
        } catch (error) {
            console.error('❌ โหลดรายการจองล้มเหลว:', error);
            tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-red-500">⚠️ โหลดข้อมูลล้มเหลว: ${escapeHtml(error.message)}</td></tr>`;
        } finally {
            isLoading = false;
        }
    }

    function scheduleReloads() {
        setTimeout(async () => {
            await loadBookings();
            if (typeof window.loadPendingCounts === 'function') window.loadPendingCounts();
        }, 800);
        setTimeout(async () => { await loadBookings(); }, 2000);
        setTimeout(async () => { await loadBookings(); }, 4000);
    }

    // ==========================================
    // 2. Render Bookings
    // ==========================================
    function renderBookings() {
        const tbody = document.getElementById('bookingTableBody');
        if (!tbody) return;

        const rawFilter = document.getElementById('statusFilter')?.value || '';
        const statusFilter = normalizeBookingStatus(rawFilter);
        const searchQuery = (document.getElementById('searchBooking')?.value || '').trim().toLowerCase();

        console.log('🔍 Filter:', { rawFilter, statusFilter });

        let filtered = allBookings.filter(b => {
            const bStatus = normalizeBookingStatus(b.status);
            // ⭐ ถ้า statusFilter ว่าง → ไม่กรอง (แสดงทุกสถานะ)
            if (statusFilter && bStatus !== statusFilter) return false;
            if (searchQuery) {
                const name = String(b.tenant_name || '').toLowerCase();
                const room = String(b.room_number || '').toLowerCase();
                if (!name.includes(searchQuery) && !room.includes(searchQuery)) return false;
            }
            return true;
        });

        filtered.sort((a, b) => new Date(b.booking_date || 0) - new Date(a.booking_date || 0));

        const countEl = document.getElementById('bookingCount');
        if (countEl) countEl.innerText = filtered.length;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">
                ${allBookings.length === 0 ? 'ยังไม่มีรายการจองในอาคารนี้' : 'ไม่พบรายการที่ตรงกับเงื่อนไข'}
            </td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(b => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition';

            const bStatus = normalizeBookingStatus(b.status);

            let deadlineHtml = formatDate(b.contract_deadline);
            if (b.contract_deadline && bStatus === 'APPROVED') {
                const deadline = new Date(b.contract_deadline);
                const today = new Date();
                const daysLeft = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
                if (daysLeft < 0) {
                    deadlineHtml += `<span class="block text-xs text-red-600 font-medium mt-1">(เลยกำหนด ${Math.abs(daysLeft)} วัน)</span>`;
                } else if (daysLeft <= 3) {
                    deadlineHtml += `<span class="block text-xs text-orange-600 font-medium mt-1">(อีก ${daysLeft} วัน)</span>`;
                }
            }

            let actionButtons = '';
            if (bStatus === 'PENDING') {
                actionButtons = `<button onclick="approveBooking(${b.booking_id})" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-md text-xs font-medium transition">✅ อนุมัติ</button>`;
            } else if (bStatus === 'APPROVED') {
                actionButtons = `<button onclick="createContract(${b.booking_id})" class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-md text-xs font-medium transition">📄 สร้างสัญญา</button>`;
            } else if (bStatus === 'COMPLETED') {
                actionButtons = `<button onclick="viewBookingDetail(${b.booking_id})" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md text-xs font-medium transition">👁️ ดูรายละเอียด</button>`;
            } else if (bStatus === 'CANCELLED') {
                actionButtons = `<button onclick="viewCancellationReason(${b.booking_id})" class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-md text-xs font-medium transition">❓ ดูเหตุผล</button>`;
            } else if (bStatus === 'EXPIRED') {
                actionButtons = `<button onclick="viewExpiredReason(${b.booking_id})" class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded-md text-xs font-medium transition">⚫ ดูสาเหตุ</button>`;
            }

            const editDeleteButtons = `
                <button onclick="openEditBookingModal(${b.booking_id})" 
                        class="text-blue-600 hover:bg-blue-50 px-2.5 py-1.5 rounded-md text-xs font-medium transition">
                    ✏️ แก้ไข
                </button>
                <button data-delete-id="${b.booking_id}" 
                        class="js-delete-booking text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-md text-xs font-medium transition">
                    🗑️
                </button>
            `;

            tr.innerHTML = `
                <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${formatDate(b.booking_date)}</td>
                <td class="px-4 py-3">
                    <span class="font-bold text-blue-600 text-base">${escapeHtml(b.room_number || '-')}</span>
                    <span class="block text-xs text-gray-400">${escapeHtml(b.room_type || '')}</span>
                </td>
                <td class="px-4 py-3">
                    <div class="font-medium text-gray-800">${escapeHtml(b.tenant_name || '-')}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(b.tenant_phone || '')}</div>
                </td>
                <td class="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">${formatNumber(b.booking_amount)} ฿</td>
                <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${deadlineHtml}</td>
                <td class="px-4 py-3">${getStatusBadge(b.status)}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                    ${actionButtons}
                    ${editDeleteButtons}
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.js-delete-booking').forEach(btn => {
            btn.addEventListener('click', function() {
                const id = parseInt(this.getAttribute('data-delete-id'));
                const booking = allBookings.find(x => Number(x.booking_id) === id);
                openDeleteBookingModal(id, booking?.tenant_name || 'ไม่ระบุ');
            });
        });
    }

    // ==========================================
    // 3. โหลดห้องว่าง
    // ==========================================
    async function loadAvailableRooms() {
        const select = document.getElementById('roomId');
        if (!select) return;

        try {
            const buildingId = getCurrentBuildingId();
            const timestamp = Date.now();
            const url = `${API_BASE}/rooms?building_id=${buildingId}&_t=${timestamp}`;
            
            const response = await fetch(url, { cache: 'no-store' });
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            let rooms = toArray(parsed);
            
            availableRooms = rooms.filter(r => {
                if (r.is_deleted === true || r.is_deleted === 'true') return false;
                return normalizeRoomStatus(r.status) === 'AVAILABLE';
            });

            select.innerHTML = '<option value="">-- เลือกห้อง --</option>';
            availableRooms.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.room_id;
                opt.textContent = `${r.room_number} • ${r.room_type} • ${formatNumber(r.default_price)} ฿`;
                select.appendChild(opt);
            });
            
            console.log(`📦 โหลด ${availableRooms.length} ห้องว่าง`);
        } catch (error) {
            console.error('❌ โหลดห้องว่างล้มเหลว:', error);
        }
    }

    // ==========================================
    // 4. Modal: Add
    // ==========================================
    async function openAddBookingModal() {
        if (!getCurrentBuildingId()) {
            showNotification('⚠️ กรุณาเลือกอาคารก่อน', 'error');
            return;
        }

        currentEditingBookingId = null;
        
        document.getElementById('bookingModalTitle').innerText = 'เพิ่มการจองใหม่';
        document.getElementById('bookingForm').reset();
        document.getElementById('bookingId').value = '';
        
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('bookingDate').value = today;
        
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 7);
        document.getElementById('contractDeadline').value = deadline.toISOString().split('T')[0];
        
        document.getElementById('bookingStatus').value = 'PENDING';
        document.getElementById('cancellationField').classList.add('hidden');
        
        await loadAvailableRooms();
        
        const modal = document.getElementById('bookingModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => document.getElementById('tenantName')?.focus(), 100);
    }

    // ==========================================
    // 5. Modal: Edit
    // ==========================================
    async function openEditBookingModal(bookingId) {
        const targetId = Number(bookingId);
        const booking = allBookings.find(b => Number(b.booking_id) === targetId);
        
        if (!booking) {
            showNotification('⚠️ ไม่พบข้อมูลการจอง', 'error');
            return;
        }

        currentEditingBookingId = targetId;
        
        document.getElementById('bookingModalTitle').innerText = `แก้ไขการจอง: ${booking.tenant_name || ''}`;
        document.getElementById('bookingId').value = booking.booking_id;
        document.getElementById('tenantName').value = booking.tenant_name || '';
        document.getElementById('tenantPhone').value = booking.tenant_phone || '';
        document.getElementById('bookingAmount').value = booking.booking_amount || 1000;
        document.getElementById('bookingDate').value = booking.booking_date || '';
        document.getElementById('contractDeadline').value = booking.contract_deadline || '';
        document.getElementById('bookingStatus').value = normalizeBookingStatus(booking.status);
        document.getElementById('cancellationReason').value = booking.cancellation_reason || '';
        
        await loadAvailableRooms();
        const roomSelect = document.getElementById('roomId');
        
        if (booking.room_id && !Array.from(roomSelect.options).some(o => Number(o.value) === Number(booking.room_id))) {
            const opt = document.createElement('option');
            opt.value = booking.room_id;
            opt.textContent = `${booking.room_number} (ห้องปัจจุบัน)`;
            roomSelect.appendChild(opt);
        }
        roomSelect.value = booking.room_id;
        
        toggleCancellationField();
        
        const modal = document.getElementById('bookingModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeBookingModal() {
        const modal = document.getElementById('bookingModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        currentEditingBookingId = null;
    }

    function toggleCancellationField() {
        const status = normalizeBookingStatus(document.getElementById('bookingStatus').value);
        const field = document.getElementById('cancellationField');
        if (status === 'CANCELLED' || status === 'EXPIRED') {
            field.classList.remove('hidden');
        } else {
            field.classList.add('hidden');
        }
    }

    // ==========================================
    // 6. บันทึก
    // ==========================================
    async function saveBookingData(e) {
        if (e) e.preventDefault();

        const btnText = document.getElementById('saveBookingBtnText');
        const submitBtn = document.getElementById('saveBookingBtn');
        
        const tenantName = document.getElementById('tenantName').value.trim();
        const tenantPhone = document.getElementById('tenantPhone').value.trim();
        const roomId = document.getElementById('roomId').value;
        const bookingAmount = parseFloat(document.getElementById('bookingAmount').value);
        const bookingDate = document.getElementById('bookingDate').value;
        const contractDeadline = document.getElementById('contractDeadline').value;
        const status = normalizeBookingStatus(document.getElementById('bookingStatus').value) || 'PENDING';
        const cancellationReason = document.getElementById('cancellationReason').value.trim();

        if (!tenantName) return showNotification('⚠️ กรุณากรอกชื่อผู้จอง', 'error');
        if (!roomId) return showNotification('⚠️ กรุณาเลือกห้อง', 'error');
        if (!bookingAmount || bookingAmount <= 0) return showNotification('⚠️ กรุณากรอกเงินจอง', 'error');
        if (!bookingDate) return showNotification('⚠️ กรุณาเลือกวันที่จอง', 'error');
        if (!contractDeadline) return showNotification('⚠️ กรุณาเลือกวันกำหนดทำสัญญา', 'error');
        if ((status === 'CANCELLED' || status === 'EXPIRED') && !cancellationReason) {
            return showNotification('⚠️ กรุณากรอกเหตุผล', 'error');
        }

        btnText.innerText = 'กำลังบันทึก...';
        submitBtn.disabled = true;

        try {
            const isEdit = currentEditingBookingId !== null;
            const endpoint = isEdit ? `${API_BASE}/bookings-update` : `${API_BASE}/bookings-create`;
            
            const payload = isEdit 
                ? {
                    booking_id: currentEditingBookingId,
                    tenant_name: tenantName,
                    tenant_phone: tenantPhone,
                    room_id: parseInt(roomId),
                    booking_amount: bookingAmount,
                    booking_date: bookingDate,
                    contract_deadline: contractDeadline,
                    status: status,
                    cancellation_reason: (status === 'CANCELLED' || status === 'EXPIRED') ? cancellationReason : null
                }
                : {
                    tenant_name: tenantName,
                    tenant_phone: tenantPhone,
                    room_id: parseInt(roomId),
                    booking_amount: bookingAmount,
                    booking_date: bookingDate,
                    contract_deadline: contractDeadline,
                    status: status,
                    building_id: parseInt(getCurrentBuildingId())
                };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const text = await response.text();
            let data = {};
            try { data = text ? JSON.parse(text) : {}; } catch(_) {}

            if (response.ok) {
                closeBookingModal();
                showNotification(isEdit ? '✅ แก้ไขการจองสำเร็จ!' : '✅ เพิ่มการจองสำเร็จ!', 'success');
                scheduleReloads();
            } else {
                throw new Error(data.message || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ บันทึกการจองล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btnText.innerText = 'บันทึก';
            submitBtn.disabled = false;
        }
    }

    // ==========================================
    // 7. อนุมัติ
    // ==========================================
    async function approveBooking(bookingId) {
        if (!confirm('ยืนยันการอนุมัติการจองนี้?')) return;

        try {
            const response = await fetch(`${API_BASE}/bookings-approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ booking_id: parseInt(bookingId) })
            });

            const text = await response.text();
            let data = {};
            try { data = text ? JSON.parse(text) : {}; } catch(_) {}

            if (response.ok) {
                showNotification('✅ อนุมัติการจองสำเร็จ!', 'success');
                scheduleReloads();
            } else {
                throw new Error(data.message || `HTTP ${response.status}`);
            }
        } catch (error) {
            showNotification('❌ ' + error.message, 'error');
        }
    }

    function createContract(bookingId) {
        localStorage.setItem('pending_booking_id', bookingId);
        window.location.href = 'contracts.html?from_booking=' + bookingId;
    }

    // ==========================================
    // 9. ดูรายละเอียด
    // ==========================================
    function viewBookingDetail(bookingId) {
        const b = allBookings.find(x => Number(x.booking_id) === Number(bookingId));
        if (!b) return;
        
        const bStatus = normalizeBookingStatus(b.status);
        alert(
            `📋 รายละเอียดการจอง #${b.booking_id}\n\n` +
            `🏠 ห้อง: ${b.room_number} (${b.room_type || '-'})\n` +
            `👤 ผู้จอง: ${b.tenant_name}\n` +
            `📞 เบอร์โทร: ${b.tenant_phone || '-'}\n` +
            `💰 เงินจอง: ${formatNumber(b.booking_amount)} บาท\n` +
            `📅 วันที่จอง: ${formatDate(b.booking_date)}\n` +
            `⏰ กำหนดสัญญา: ${formatDate(b.contract_deadline)}\n` +
            `📊 สถานะ: ${STATUS_CONFIG[bStatus]?.label || bStatus}`
        );
    }

    // ==========================================
    // 10. ดูเหตุผลยกเลิก / หมดอายุ
    // ==========================================
    function viewCancellationReason(bookingId) {
        const b = allBookings.find(x => Number(x.booking_id) === Number(bookingId));
        if (!b) return;

        document.getElementById('reasonModalTitle').innerHTML = '<span>⚠️</span> รายละเอียดการยกเลิก';
        document.getElementById('reasonModalHeader').className = 'flex items-center justify-between p-5 border-b border-gray-200 bg-red-50';
        document.getElementById('reasonModalTitle').className = 'text-lg font-bold text-red-700 flex items-center gap-2';
        document.getElementById('modalDepositStatus').innerText = 'ริบเงินมัดจำเข้าส่วนกลาง';
        document.getElementById('modalReasonLabel').innerText = 'เหตุผลที่ยกเลิก:';

        document.getElementById('modalRoom').innerText = b.room_number || '-';
        document.getElementById('modalName').innerText = b.tenant_name || '-';
        document.getElementById('modalReason').innerText = b.cancellation_reason || 'ไม่ระบุเหตุผล';
        
        const modal = document.getElementById('reasonModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function viewExpiredReason(bookingId) {
        const b = allBookings.find(x => Number(x.booking_id) === Number(bookingId));
        if (!b) return;

        document.getElementById('reasonModalTitle').innerHTML = '<span>⚫</span> รายละเอียดการหมดอายุ';
        document.getElementById('reasonModalHeader').className = 'flex items-center justify-between p-5 border-b border-gray-200 bg-gray-100';
        document.getElementById('reasonModalTitle').className = 'text-lg font-bold text-gray-700 flex items-center gap-2';
        document.getElementById('modalDepositStatus').innerText = 'ริบเงินมัดจำเข้าส่วนกลาง';
        document.getElementById('modalReasonLabel').innerText = 'สาเหตุที่หมดอายุ:';

        document.getElementById('modalRoom').innerText = b.room_number || '-';
        document.getElementById('modalName').innerText = b.tenant_name || '-';
        document.getElementById('modalReason').innerText = 
            b.cancellation_reason || 'ผู้จองไม่มาทำสัญญาภายในกำหนดเวลา';
        
        const modal = document.getElementById('reasonModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeReasonModal() {
        const modal = document.getElementById('reasonModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    // ==========================================
    // 11. Soft Delete
    // ==========================================
    function openDeleteBookingModal(bookingId, tenantName) {
        deletingBookingId = bookingId;
        deletingBookingName = tenantName;
        document.getElementById('deleteBookingName').innerText = tenantName || 'ไม่ระบุ';
        
        const modal = document.getElementById('deleteBookingModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeDeleteBookingModal() {
        const modal = document.getElementById('deleteBookingModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        deletingBookingId = null;
        deletingBookingName = '';
    }

    async function confirmDeleteBooking() {
        if (!deletingBookingId) return;

        const btn = document.getElementById('confirmDeleteBookingBtn');
        btn.disabled = true;
        btn.innerText = 'กำลังซ่อน...';

        try {
            const response = await fetch(`${API_BASE}/bookings-delete?id=${deletingBookingId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                closeDeleteBookingModal();
                showNotification('🗑️ ซ่อนการจองสำเร็จ', 'success');
                allBookings = allBookings.filter(b => Number(b.booking_id) !== Number(deletingBookingId));
                renderBookings();
                scheduleReloads();
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerText = 'ซ่อนการจอง';
        }
    }

    // ==========================================
    // 12. Filters
    // ==========================================
    function setupFilters() {
        const statusFilter = document.getElementById('statusFilter');
        const search = document.getElementById('searchBooking');
        
        if (statusFilter) statusFilter.addEventListener('change', renderBookings);
        if (search) {
            search.addEventListener('input', () => {
                clearTimeout(window._bookingSearchTimer);
                window._bookingSearchTimer = setTimeout(renderBookings, 200);
            });
        }
    }

    // ==========================================
    // 13. Export
    // ==========================================
    window.openAddBookingModal = openAddBookingModal;
    window.openEditBookingModal = openEditBookingModal;
    window.closeBookingModal = closeBookingModal;
    window.openDeleteBookingModal = openDeleteBookingModal;
    window.closeDeleteBookingModal = closeDeleteBookingModal;
    window.closeReasonModal = closeReasonModal;
    window.approveBooking = approveBooking;
    window.createContract = createContract;
    window.viewBookingDetail = viewBookingDetail;
    window.viewCancellationReason = viewCancellationReason;
    window.viewExpiredReason = viewExpiredReason;
    window.loadBookings = loadBookings;

    // ==========================================
    // 14. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 bookings.js v5.1 เริ่มทำงาน');
        
        setTimeout(() => { loadBookings(); }, 300);

        const form = document.getElementById('bookingForm');
        if (form) form.addEventListener('submit', saveBookingData);

        const statusSelect = document.getElementById('bookingStatus');
        if (statusSelect) statusSelect.addEventListener('change', toggleCancellationField);

        const confirmBtn = document.getElementById('confirmDeleteBookingBtn');
        if (confirmBtn) confirmBtn.addEventListener('click', confirmDeleteBooking);

        setupFilters();

        window.addEventListener('buildingChanged', () => {
            console.log('🔄 เปลี่ยนอาคาร → โหลดใหม่');
            loadBookings();
        });

        lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const currentId = getCurrentBuildingId();
            if (currentId !== lastBuildingId) {
                lastBuildingId = currentId;
                console.log('🔄 ตรวจพบการเปลี่ยนอาคาร:', lastBuildingId, '→', currentId);
                loadBookings();
            }
        }, 1000);

        console.log('✅ bookings.js v5.1 โหลดสำเร็จ');
    });

})();
