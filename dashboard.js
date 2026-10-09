/* ==========================================
 * dashboard.js - แดชบอร์ดภาพรวม
 * ⭐ v4: ใช้ /payments สำหรับยอดค้าง + warnings จาก bookings+payments
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'https://n8n_mirot.minmark.xyz/webhook';

    let lastBuildingId = '';
    let isLoading = false;

    const showNotification = window.showNotification;
    const escapeHtml = window.escapeHtml;
    const formatNumber = window.formatNumber;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

    // ==========================================
    // ⭐ Helpers — Defensive
    // ==========================================
    function unwrapItem(item) {
        if (!item || typeof item !== 'object') return null;
        if (item.json && typeof item.json === 'object' && !Array.isArray(item.json)) {
            return { ...item.json };
        }
        return item;
    }

    function normalizeStatus(s) {
        return String(s || '').trim().toUpperCase();
    }

    function normalizeRoomStatus(s) {
        const u = normalizeStatus(s);
        if (u === 'VACANT') return 'AVAILABLE';
        if (u === 'REPAIR') return 'MAINTENANCE';
        return u;
    }

    function getField(obj, ...keys) {
        for (const k of keys) {
            if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
        }
        return null;
    }

    function isRoomOccupied(r) { return normalizeRoomStatus(getField(r, 'status', 'room_status')) === 'OCCUPIED'; }
    function isRoomAvailable(r) { return normalizeRoomStatus(getField(r, 'status', 'room_status')) === 'AVAILABLE'; }
    function isRoomBooked(r) { return normalizeRoomStatus(getField(r, 'status', 'room_status')) === 'BOOKED'; }
    function isPaid(inv) {
        const v = getField(inv, 'is_paid', 'paid');
        return v === true || v === 'true' || v === 1 || v === '1';
    }
    function hasSlip(inv) {
        return !!getField(inv, 'slip_image_url', 'slip_url');
    }

    // ==========================================
    // 1. โหลดแดชบอร์ด
    // ==========================================
    async function loadDashboard() {
        if (isLoading) return;
        isLoading = true;

        try {
            const buildingId = getCurrentBuildingId();
            if (!buildingId) {
                console.warn('⚠️ ยังไม่ได้เลือกอาคาร');
                isLoading = false;
                return;
            }

            console.log('🚀 โหลดแดชบอร์ด building_id =', buildingId);

            const [roomsRaw, paymentsRaw, bookingsRaw, buildingsRaw] = await Promise.all([
                fetchJson(`${API_BASE}/rooms?building_id=${buildingId}`).catch(e => { console.error('rooms error', e); return []; }),
                fetchJson(`${API_BASE}/payments?building_id=${buildingId}`).catch(e => { console.error('payments error', e); return []; }),
                fetchJson(`${API_BASE}/bookings?building_id=${buildingId}`).catch(e => { console.error('bookings error', e); return []; }),
                fetchJson(`${API_BASE}/buildings`).catch(e => { console.error('buildings error', e); return []; })
            ]);

            const rooms = normalizeArr(roomsRaw).filter(r => !isDeleted(r));
            const payments = normalizeArr(paymentsRaw).filter(p => !isDeleted(p));
            const bookings = normalizeArr(bookingsRaw).filter(b => !isDeleted(b));
            const buildings = normalizeArr(buildingsRaw).filter(b => !isDeleted(b));

            // ⭐ Debug — แสดงข้อมูลชิ้นแรกเพื่อเช็ค field
            console.log('🔍 rooms sample:', rooms[0]);
            console.log('🔍 payments sample:', payments[0]);
            console.log('🔍 bookings sample:', bookings[0]);

            renderStats(rooms, payments);
            renderBuildings(buildings);
            renderWarnings(rooms, payments, bookings);
            renderVacantRooms(rooms);

            console.log(`📊 Rooms: ${rooms.length} | Payments: ${payments.length} | Bookings: ${bookings.length}`);

        } catch (error) {
            console.error('❌ โหลดแดชบอร์ดล้มเหลว:', error);
            showNotification('❌ โหลดแดชบอร์ดไม่สำเร็จ', 'error');
        } finally {
            isLoading = false;
        }
    }

    function normalizeArr(raw) {
        let arr = toArray(raw);
        return arr.map(unwrapItem).filter(Boolean);
    }

    function isDeleted(obj) {
        if (!obj) return true;
        const v = obj.is_deleted;
        return v === true || v === 'true';
    }

    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        return text ? JSON.parse(text) : [];
    }

    // ==========================================
    // 2. Stats 4 กล่อง
    // ==========================================
    function renderStats(rooms, payments) {
        // 1. ห้องมีผู้เช่า
        const occupiedCount = rooms.filter(isRoomOccupied).length;
        setText('statOccupied', occupiedCount);
        setText('statTotalRooms', rooms.length);

        // 2. รายการค้างชำระ (จาก payments ที่ is_paid=false)
        const unpaidInvoices = payments.filter(p => !isPaid(p));
        setText('statUnpaid', unpaidInvoices.length);

        // 3. ห้องที่ยังไม่ชำระ (unique room)
        const unpaidRoomIds = new Set(
            unpaidInvoices
                .map(p => getField(p, 'room_id'))
                .filter(id => id !== null && id !== undefined)
        );
        setText('statUnpaidRooms', unpaidRoomIds.size);

        // 4. ยอดรับชำระแล้วเดือนนี้
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        const paidThisMonth = payments.filter(p => {
            if (!isPaid(p)) return false;
            const paidDate = getField(p, 'paid_date', 'updated_at');
            if (!paidDate) return false;
            return String(paidDate).startsWith(currentMonth);
        });
        
        const totalPaid = paidThisMonth.reduce((sum, p) => {
            const amt = parseFloat(getField(p, 'paid_amount', 'total_amount')) || 0;
            return sum + amt;
        }, 0);
        
        setText('statRevenue', formatNumber(totalPaid));
    }

    // ==========================================
    // 3. รายชื่ออาคาร
    // ==========================================
    function renderBuildings(buildings) {
        const container = document.getElementById('buildingList');
        if (!container) return;

        if (buildings.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">ยังไม่มีอาคารในระบบ</p>';
            return;
        }

        const currentId = Number(getCurrentBuildingId());
        container.innerHTML = buildings.map(b => {
            const isActive = Number(b.building_id) === currentId;
            const borderCls = isActive ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white';
            return `
                <div class="flex items-center justify-between p-3 border rounded-lg ${borderCls} hover:shadow-sm transition">
                    <div>
                        <div class="font-semibold text-gray-800">${escapeHtml(b.building_name || '-')}</div>
                        <div class="text-xs text-gray-500">${escapeHtml(b.address || '')}</div>
                    </div>
                    <button onclick="event.stopPropagation(); deleteBuildingById(${b.building_id}, '${escapeHtml(b.building_name || '')}')" 
                            class="text-red-500 hover:bg-red-50 p-2 rounded-md transition" title="ลบอาคาร">
                        🗑️
                    </button>
                </div>
            `;
        }).join('');
    }

    // ==========================================
    // 4. รายการแจ้งเตือน — รวม 2 แหล่ง
    //    (1) ห้องที่จองแล้วรอมัดจำ (BOOKED)
    //    (2) บิลค้างชำระ (จาก payments)
    // ==========================================
    function renderWarnings(rooms, payments, bookings) {
        const container = document.querySelector('#warningsTable tbody')
                       || findWarningsTbody();
        if (!container) {
            console.warn('⚠️ ไม่พบ tbody ของตาราง warnings');
            return;
        }

        const warnings = [];
        const now = new Date();

        // ⭐ 1) ห้องที่ BOOKED — รอมัดจำ/รอ Check-in
        rooms.filter(isRoomBooked).forEach(r => {
            warnings.push({
                type: '📅 รอชำระมัดจำ',
                detail: `ห้อง ${r.room_number || '-'} (${r.room_type || '-'}) — รอลูกค้าจ่ายมัดจำ`,
                level: 'warning',
                action: `<a href="bookings.html" class="text-blue-600 hover:underline text-xs">ดูการจอง →</a>`
            });
        });

        // ⭐ 2) บิลค้างชำระ (จาก payments)
        payments.filter(p => !isPaid(p)).forEach(p => {
            const dueDate = getField(p, 'due_date');
            let overdueDays = 0;
            let label = '';
            
            if (dueDate) {
                const d = new Date(dueDate);
                if (!isNaN(d.getTime())) {
                    overdueDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
                }
            }
            
            if (overdueDays > 0) {
                label = `เลย ${overdueDays} วัน`;
            } else {
                label = 'ยังไม่ถึงกำหนด';
            }
            
            const roomNo = getField(p, 'room_number', 'room_no') || '-';
            const tenant = getField(p, 'tenant_name', 'tenant') || '-';
            const amt = parseFloat(getField(p, 'total_amount', 'amount')) || 0;
            
            warnings.push({
                type: overdueDays > 0 ? '💰 ค้างชำระ' : '💵 รอชำระ',
                detail: `ห้อง ${roomNo} — ${tenant} • ${formatNumber(amt)} ฿ (${label})`,
                level: overdueDays > 0 ? 'danger' : 'info',
                action: `<a href="payments.html" class="text-blue-600 hover:underline text-xs">ไปรับชำระ →</a>`
            });
        });

        if (warnings.length === 0) {
            container.innerHTML = '<tr><td colspan="3" class="px-4 py-6 text-center text-gray-400">ยังไม่มีรายการแจ้งเตือน</td></tr>';
            return;
        }

        const levelCls = {
            warning: 'text-yellow-700 bg-yellow-50',
            danger: 'text-red-700 bg-red-50',
            info: 'text-blue-700 bg-blue-50'
        };

        container.innerHTML = warnings.map(w => `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3">
                    <span class="inline-block px-2 py-1 rounded-md text-xs font-medium ${levelCls[w.level] || ''}">
                        ${escapeHtml(w.type)}
                    </span>
                </td>
                <td class="px-4 py-3 text-gray-700 text-sm">${escapeHtml(w.detail)}</td>
                <td class="px-4 py-3 text-right">${w.action || '-'}</td>
            </tr>
        `).join('');
    }

    function findWarningsTbody() {
        const headers = document.querySelectorAll('h4');
        for (const h of headers) {
            if (h.textContent.includes('รายการแจ้งเตือน')) {
                const section = h.closest('div');
                if (section) return section.querySelector('tbody');
            }
        }
        return null;
    }

    // ==========================================
    // 5. ห้องว่าง
    // ==========================================
    function renderVacantRooms(rooms) {
        const container = document.getElementById('vacantRoomList');
        if (!container) return;

        const available = rooms
            .filter(isRoomAvailable)
            .sort((a, b) => String(a.room_number || '').localeCompare(String(b.room_number || ''), 'th', { numeric: true }));

        console.log('🏠 ห้องว่าง:', available.length, 'ห้อง');

        if (available.length === 0) {
            container.innerHTML = '<p class="text-gray-400 text-sm text-center py-4">ไม่มีห้องว่าง</p>';
            return;
        }

        container.innerHTML = available.map(room => `
            <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg mb-2">
                <div>
                    <div class="font-bold text-blue-600">${escapeHtml(room.room_number || '-')}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(room.room_type || '-')} • ${formatNumber(room.default_price)} ฿</div>
                </div>
                <span class="text-green-600 text-sm font-medium">ว่าง</span>
            </div>
        `).join('');
    }

    // ==========================================
    // 6. Helper
    // ==========================================
    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    }

    // ==========================================
    // 7. ปุ่ม/Modal อาคาร
    // ==========================================
    function openAddBuildingModal() {
        document.getElementById('addBuildingForm').reset();
        const modal = document.getElementById('addBuildingModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeAddBuildingModal() {
        const modal = document.getElementById('addBuildingModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    async function saveBuilding(e) {
        if (e) e.preventDefault();
        const name = document.getElementById('buildingName').value.trim();
        const address = document.getElementById('buildingAddress').value.trim();
        const btnText = document.getElementById('saveBtnText');
        const submitBtn = document.getElementById('saveBuildingBtn');

        if (!name) return showNotification('⚠️ กรุณากรอกชื่ออาคาร', 'error');

        btnText.innerText = 'กำลังบันทึก...';
        submitBtn.disabled = true;

        try {
            const res = await fetch(`${API_BASE}/buildings-create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ building_name: name, address: address || null })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            closeAddBuildingModal();
            showNotification('✅ เพิ่มอาคารสำเร็จ!', 'success');
            setTimeout(() => loadDashboard(), 500);
            if (typeof window.loadBuildings === 'function') window.loadBuildings();
        } catch (err) {
            console.error('❌', err);
            showNotification('❌ ' + err.message, 'error');
        } finally {
            btnText.innerText = 'บันทึก';
            submitBtn.disabled = false;
        }
    }

    async function deleteBuildingById(id, name) {
        if (!confirm(`⚠️ ต้องการลบอาคาร "${name}" หรือไม่?`)) return;

        try {
            const res = await fetch(`${API_BASE}/buildings-delete?id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            showNotification('🗑️ ลบอาคารสำเร็จ', 'success');
            setTimeout(() => loadDashboard(), 500);
            if (typeof window.loadBuildings === 'function') window.loadBuildings();
        } catch (err) {
            console.error('❌', err);
            showNotification('❌ ' + err.message, 'error');
        }
    }

    function deleteCurrentBuilding() {
        const id = getCurrentBuildingId();
        const name = getCurrentBuildingName();
        if (!id) return showNotification('⚠️ กรุณาเลือกอาคารก่อน', 'error');
        deleteBuildingById(Number(id), name || '');
    }

    function refreshDashboard() {
        showNotification('🔄 กำลังรีเฟรช...', 'info');
        loadDashboard();
        if (typeof window.loadBuildings === 'function') window.loadBuildings();
    }

    // ==========================================
    // 8. Export ไปที่ window
    // ==========================================
    window.openAddBuildingModal = openAddBuildingModal;
    window.closeAddBuildingModal = closeAddBuildingModal;
    window.deleteCurrentBuilding = deleteCurrentBuilding;
    window.deleteBuildingById = deleteBuildingById;
    window.refreshDashboard = refreshDashboard;
    window.loadDashboard = loadDashboard;

    // ==========================================
    // 9. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 dashboard.js v4 เริ่มทำงาน');

        setTimeout(() => loadDashboard(), 300);

        const form = document.getElementById('addBuildingForm');
        if (form) form.addEventListener('submit', saveBuilding);

        window.addEventListener('buildingChanged', () => {
            console.log('🔄 เปลี่ยนอาคาร → โหลดแดชบอร์ดใหม่');
            loadDashboard();
        });

        lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const currentId = getCurrentBuildingId();
            if (currentId !== lastBuildingId) {
                lastBuildingId = currentId;
                loadDashboard();
            }
        }, 1000);

        console.log('✅ dashboard.js v4 โหลดสำเร็จ');
    });

})();
