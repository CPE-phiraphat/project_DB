/* ==========================================
 * rooms.js - จัดการข้อมูลห้องพัก (v5)
 * ⭐ v5: เช็คห้องซ้ำ + รองรับ soft delete กลับมาสร้างใหม่
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'https://n8n_mirot.minmark.xyz/webhook';

    let allRooms = [];
    let currentEditingRoomId = null;
    let deletingRoomId = null;

    const showNotification = window.showNotification;
    const escapeHtml = window.escapeHtml;
    const formatNumber = window.formatNumber;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

    // ==========================================
    // Status
    // ==========================================
    const STATUS_CONFIG = {
        'AVAILABLE':   { label: 'ว่าง',           bg: 'bg-green-100',  text: 'text-green-700',  icon: '🟢' },
        'OCCUPIED':    { label: 'มีผู้เช่า',      bg: 'bg-blue-100',   text: 'text-blue-700',   icon: '🔵' },
        'BOOKED':      { label: 'จองแล้ว',        bg: 'bg-yellow-100', text: 'text-yellow-700', icon: '🟡' },
        'MAINTENANCE': { label: 'ปิดซ่อม',        bg: 'bg-red-100',    text: 'text-red-700',    icon: '🔴' }
    };

    function normalizeStatus(status) {
        if (status === null || status === undefined) return '';
        const s = String(status).trim().toUpperCase();
        if (s === '') return '';
        if (s === 'VACANT') return 'AVAILABLE';
        if (s === 'OCCUPIED') return 'OCCUPIED';
        if (s === 'BOOKED') return 'BOOKED';
        if (s === 'MAINTENANCE' || s === 'REPAIR') return 'MAINTENANCE';
        if (s === 'AVAILABLE') return 'AVAILABLE';
        return s;
    }

    function getStatusBadge(status) {
        const key = normalizeStatus(status);
        const cfg = STATUS_CONFIG[key] || { label: key || '-', bg: 'bg-gray-100', text: 'text-gray-700', icon: '⚪' };
        return `<span class="px-2.5 py-1 ${cfg.bg} ${cfg.text} rounded-full text-xs font-medium inline-block">${cfg.icon} ${cfg.label}</span>`;
    }

    // ==========================================
    // ⭐ Datalist suggestion — ประเภทห้อง
    // ==========================================
    function populateRoomTypes() {
        const datalist = document.getElementById('roomTypeList');
        if (!datalist) return;

        const types = new Set();
        allRooms.forEach(r => {
            const t = String(r.room_type || '').trim();
            if (t) types.add(t);
        });

        datalist.innerHTML = '';
        [...types].sort().forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            datalist.appendChild(opt);
        });

        console.log('📋 ประเภทห้องที่มีในระบบ:', [...types]);
    }

    // ==========================================
    // 1. โหลดรายการห้องพัก
    // ==========================================
    async function loadRooms() {
        const tbody = document.getElementById('roomTableBody');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">กำลังโหลดข้อมูล...</td></tr>';

        try {
            const buildingId = getCurrentBuildingId();
            if (!buildingId) {
                tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">กรุณาเลือกอาคารก่อน</td></tr>';
                return;
            }

            const url = `${API_BASE}/rooms?building_id=${buildingId}&_t=${Date.now()}`;
            console.log('🌐 โหลดห้องพักจาก:', url);
            
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            let rooms = toArray(parsed);
            
            allRooms = rooms.filter(room => {
                if (room.is_deleted === true || room.is_deleted === 'true') return false;
                return true;
            });
            
            allRooms = allRooms.map(room => ({
                ...room,
                status: normalizeStatus(room.status) || 'AVAILABLE'
            }));
            
            console.log(`📦 โหลดห้องทั้งหมด ${rooms.length} ห้อง → แสดง ${allRooms.length} ห้อง`);
            
            renderRooms();
            populateRoomTypes();
            
            const subtitle = document.getElementById('roomSubtitle');
            if (subtitle) {
                subtitle.innerText = `แสดงข้อมูลห้องพักของ ${getCurrentBuildingName() || 'อาคารปัจจุบัน'}`;
            }
            
        } catch (error) {
            console.error('❌ โหลดห้องพักล้มเหลว:', error);
            tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-red-500">⚠️ โหลดข้อมูลล้มเหลว: ${escapeHtml(error.message)}</td></tr>`;
        }
    }

    // ==========================================
    // 2. แสดงรายการห้อง
    // ==========================================
    function renderRooms() {
        const tbody = document.getElementById('roomTableBody');
        if (!tbody) return;

        const statusFilter = normalizeStatus(document.getElementById('statusFilter')?.value || '');
        const searchQuery = (document.getElementById('searchRoom')?.value || '').trim().toLowerCase();

        let filtered = allRooms.filter(room => {
            const roomStatus = normalizeStatus(room.status);
            if (statusFilter && roomStatus !== statusFilter) return false;
            if (searchQuery && !String(room.room_number || '').toLowerCase().includes(searchQuery)) return false;
            return true;
        });

        filtered.sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), 'th', { numeric: true }));

        const countEl = document.getElementById('roomCount');
        if (countEl) countEl.innerText = filtered.length;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">
                ${allRooms.length === 0 ? 'ยังไม่มีห้องพักในอาคารนี้ กรุณาเพิ่มห้องพักใหม่' : 'ไม่พบห้องที่ตรงกับเงื่อนไข'}
            </td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(room => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition';
            tr.innerHTML = `
                <td class="px-4 py-3">
                    <span class="font-bold text-blue-600 text-base">${escapeHtml(room.room_number)}</span>
                </td>
                <td class="px-4 py-3 text-gray-700">${escapeHtml(room.room_type || '-')}</td>
                <td class="px-4 py-3 font-medium text-gray-800">${formatNumber(room.default_price)} ฿</td>
                <td class="px-4 py-3">${getStatusBadge(room.status)}</td>
                <td class="px-4 py-3 text-right">
                    <button onclick="openEditRoomModal(${room.room_id})" 
                            class="text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-md text-xs font-medium transition mr-1">
                        ✏️ แก้ไข
                    </button>
                    <button onclick="openDeleteRoomModal(${room.room_id}, '${escapeHtml(room.room_number)}')" 
                            class="text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-md text-xs font-medium transition"
                            title="ซ่อนห้อง (ข้อมูลยังอยู่ในระบบ)">
                        🗑️ ลบ
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ==========================================
    // 3. Modal: เพิ่มห้องใหม่
    // ==========================================
    function openAddRoomModal() {
        if (!getCurrentBuildingId()) {
            showNotification('⚠️ กรุณาเลือกอาคารก่อนเพิ่มห้อง', 'error');
            return;
        }

        currentEditingRoomId = null;
        
        populateRoomTypes();
        
        document.getElementById('roomModalTitle').innerText = 'เพิ่มห้องพักใหม่';
        document.getElementById('roomForm').reset();
        document.getElementById('roomId').value = '';
        document.getElementById('roomNumber').readOnly = false;
        document.getElementById('roomNumber').classList.remove('bg-gray-100');
        document.getElementById('roomNumberHint').innerText = '';
        
        document.getElementById('roomStatus').value = 'AVAILABLE';
        
        const modal = document.getElementById('roomModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => document.getElementById('roomNumber')?.focus(), 100);
    }

    // ==========================================
    // 4. Modal: แก้ไขห้อง
    // ==========================================
    function openEditRoomModal(roomId) {
        const targetId = Number(roomId);
        const room = allRooms.find(r => Number(r.room_id) === targetId);
        
        if (!room) {
            console.warn('❌ หาห้องไม่เจอ, roomId =', roomId);
            showNotification('⚠️ ไม่พบข้อมูลห้อง', 'error');
            return;
        }

        currentEditingRoomId = targetId;
        
        populateRoomTypes();
        
        document.getElementById('roomModalTitle').innerText = `แก้ไขห้อง ${room.room_number}`;
        document.getElementById('roomId').value = room.room_id;
        document.getElementById('roomNumber').value = room.room_number;
        document.getElementById('roomNumber').readOnly = true;
        document.getElementById('roomNumber').classList.add('bg-gray-100');
        document.getElementById('roomNumberHint').innerText = '⚠️ ไม่สามารถแก้ไขเลขห้องได้';
        document.getElementById('roomType').value = room.room_type || '';
        document.getElementById('roomPrice').value = room.default_price || '';
        document.getElementById('roomStatus').value = normalizeStatus(room.status) || 'AVAILABLE';
        
        const modal = document.getElementById('roomModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeRoomModal() {
        const modal = document.getElementById('roomModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    // ==========================================
    // 5. บันทึกข้อมูลห้อง
    // ==========================================
    async function saveRoomData(e) {
        if (e) e.preventDefault();

        const btnText = document.getElementById('saveRoomBtnText');
        const submitBtn = document.getElementById('saveRoomBtn');
        
        const roomNumber = document.getElementById('roomNumber').value.trim();
        const roomType = document.getElementById('roomType').value.trim();
        const roomPrice = parseFloat(document.getElementById('roomPrice').value);
        const roomStatus = normalizeStatus(document.getElementById('roomStatus').value) || 'AVAILABLE';
        const buildingId = getCurrentBuildingId();

        // Validation
        if (!roomNumber) return showNotification('⚠️ กรุณากรอกเลขห้อง', 'error');
        if (!roomType) return showNotification('⚠️ กรุณากรอกประเภทห้อง', 'error');
        if (!roomPrice || roomPrice <= 0) return showNotification('⚠️ กรุณากรอกราคาให้ถูกต้อง', 'error');
        if (!buildingId) return showNotification('⚠️ ไม่พบอาคารปัจจุบัน', 'error');

        const isEdit = currentEditingRoomId !== null;

        // ⭐ เช็คห้องซ้ำในอาคารเดียวกัน (เฉพาะตอนสร้างใหม่)
        if (!isEdit) {
            const exists = allRooms.find(r => 
                String(r.room_number).trim() === String(roomNumber).trim()
            );
            if (exists) {
                return showNotification(`⚠️ มีห้อง "${roomNumber}" ในอาคารนี้อยู่แล้ว`, 'error');
            }
        }

        btnText.innerText = 'กำลังบันทึก...';
        submitBtn.disabled = true;

        try {
            const endpoint = isEdit ? `${API_BASE}/rooms-update` : `${API_BASE}/rooms-create`;
            
            const payload = isEdit 
                ? { room_id: currentEditingRoomId, room_type: roomType, default_price: roomPrice, status: roomStatus }
                : { room_number: roomNumber, room_type: roomType, default_price: roomPrice, status: roomStatus, building_id: parseInt(buildingId) };

            console.log('💾 บันทึกห้อง:', { isEdit, payload });

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const text = await response.text();
            let data = {};
            try { data = text ? JSON.parse(text) : {}; } catch(_) {}

            if (response.ok) {
                closeRoomModal();
                showNotification(isEdit ? '✅ แก้ไขห้องสำเร็จ!' : '✅ เพิ่มห้องสำเร็จ!', 'success');
                
                setTimeout(async () => {
                    await loadRooms();
                }, 500);
            } else {
                throw new Error(data.message || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ บันทึกห้องล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btnText.innerText = 'บันทึก';
            submitBtn.disabled = false;
        }
    }

    // ==========================================
    // 6. Soft Delete ห้อง
    // ==========================================
    function openDeleteRoomModal(roomId, roomNumber) {
        deletingRoomId = roomId;
        document.getElementById('deleteRoomName').innerText = roomNumber;
        
        const modal = document.getElementById('deleteRoomModal');
        if (modal) {
            const msgEl = modal.querySelector('p.text-sm');
            if (msgEl) {
                msgEl.innerHTML = `คุณต้องการซ่อนห้อง <span id="deleteRoomName" class="font-bold text-red-600">${escapeHtml(roomNumber)}</span> ใช่หรือไม่?`;
            }
            const descEl = modal.querySelector('p.text-xs');
            if (descEl) {
                descEl.innerText = 'ห้องจะถูกซ่อนจากรายการ แต่ข้อมูลและประวัติยังอยู่';
            }
        }
        
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeDeleteRoomModal() {
        const modal = document.getElementById('deleteRoomModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        deletingRoomId = null;
    }

    async function confirmDeleteRoom() {
        if (!deletingRoomId) return;

        const btn = document.getElementById('confirmDeleteBtn');
        btn.disabled = true;
        btn.innerText = 'กำลังซ่อน...';

        try {
            console.log('🗑️ Soft delete ห้อง room_id =', deletingRoomId);
            
            const response = await fetch(`${API_BASE}/rooms-delete?id=${deletingRoomId}`, {
                method: 'DELETE'
            });

            const text = await response.text();
            
            // ⭐ รองรับทั้ง response ว่างเปล่า และ JSON
            if (response.ok && (!text || text.trim() === '' || text === '[]')) {
                closeDeleteRoomModal();
                showNotification('🗑️ ซ่อนห้องสำเร็จ', 'success');
                
                allRooms = allRooms.filter(r => Number(r.room_id) !== Number(deletingRoomId));
                renderRooms();
                
                setTimeout(async () => { await loadRooms(); }, 500);
                return;
            }
            
            let data = {};
            try { data = text ? JSON.parse(text) : {}; } catch(_) {}

            if (response.ok) {
                closeDeleteRoomModal();
                showNotification('🗑️ ซ่อนห้องสำเร็จ', 'success');
                
                allRooms = allRooms.filter(r => Number(r.room_id) !== Number(deletingRoomId));
                renderRooms();
                
                setTimeout(async () => { await loadRooms(); }, 500);
            } else {
                throw new Error(data.message || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ ซ่อนห้องล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerText = 'ซ่อนห้อง';
        }
    }

    // ==========================================
    // 7. Filters
    // ==========================================
    function setupFilters() {
        const statusFilter = document.getElementById('statusFilter');
        const searchRoom = document.getElementById('searchRoom');
        
        if (statusFilter) statusFilter.addEventListener('change', renderRooms);
        if (searchRoom) {
            searchRoom.addEventListener('input', () => {
                clearTimeout(window._roomSearchTimer);
                window._roomSearchTimer = setTimeout(renderRooms, 200);
            });
        }
    }

    // ==========================================
    // 8. Export
    // ==========================================
    window.openAddRoomModal = openAddRoomModal;
    window.openEditRoomModal = openEditRoomModal;
    window.closeRoomModal = closeRoomModal;
    window.openDeleteRoomModal = openDeleteRoomModal;
    window.closeDeleteRoomModal = closeDeleteRoomModal;
    window.loadRooms = loadRooms;
    window.normalizeRoomStatus = normalizeStatus;

    // ==========================================
    // 9. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(() => {
            loadRooms();
        }, 300);

        const form = document.getElementById('roomForm');
        if (form) form.addEventListener('submit', saveRoomData);

        const confirmBtn = document.getElementById('confirmDeleteBtn');
        if (confirmBtn) confirmBtn.addEventListener('click', confirmDeleteRoom);

        setupFilters();

        window.addEventListener('buildingChanged', () => {
            console.log('🔄 เปลี่ยนอาคาร → โหลดห้องใหม่');
            loadRooms();
        });

        let lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const currentId = getCurrentBuildingId();
            if (currentId !== lastBuildingId) {
                lastBuildingId = currentId;
                console.log('🔄 ตรวจพบการเปลี่ยนอาคาร → โหลดห้องใหม่');
                loadRooms();
            }
        }, 500);

        console.log('✅ rooms.js v5 โหลดสำเร็จ');
    });

})();
