/* ==========================================
 * ระบบจัดการหอพัก - Central JavaScript
 * ⭐ v7: รองรับ Soft Delete อาคาร + filter is_deleted
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'https://n8n_mirot.minmark.xyz/webhook';

    // ==========================================
    // 1. Auth Guard
    // ==========================================
    const token = localStorage.getItem('admin_token');
    const username = localStorage.getItem('admin_username');
    const currentPage = window.location.pathname.split('/').pop();

    if (!token && currentPage !== 'login.html' && currentPage !== '') {
        window.location.href = 'login.html';
        return;
    }

    // ==========================================
    // 2. Helpers
    // ==========================================
    function getCurrentBuildingId() { return localStorage.getItem('selected_building_id') || ''; }
    function getCurrentBuildingName() { return localStorage.getItem('selected_building_name') || ''; }

    function toArray(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (Array.isArray(raw.data)) return raw.data;
        if (typeof raw === 'object') return [raw];
        return [];
    }

    function toObject(raw) {
        if (!raw) return {};
        if (Array.isArray(raw)) {
            if (raw.length === 0) return {};
            const first = raw[0];
            if (first && first.json) return first.json;
            return first || {};
        }
        if (typeof raw === 'object') {
            if (raw.data && !Array.isArray(raw.data) && typeof raw.data === 'object') return raw.data;
            if (raw.json && typeof raw.json === 'object') return raw.json;
            return raw;
        }
        return {};
    }

    function formatNumber(num) { return Number(num || 0).toLocaleString('th-TH'); }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }

    function showNotification(message, type = 'info') {
        const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-blue-500' };
        const toast = document.createElement('div');
        toast.className = `fixed top-5 left-1/2 -translate-x-1/2 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-[100] transition-opacity duration-300`;
        toast.innerText = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
    }

    // ==========================================
    // displayUsername — fallback 'admin'
    // ==========================================
    function displayUsername() {
        let nameToShow = username || 'admin';
        
        if (typeof nameToShow === 'string' && (nameToShow.includes('{{') || nameToShow.includes('}}'))) {
            console.warn('⚠️ พบ template string ใน username → ใช้ admin แทน');
            nameToShow = 'admin';
            try { localStorage.setItem('admin_username', 'admin'); } catch(e) {}
        }
        
        nameToShow = String(nameToShow).trim() || 'admin';
        
        ['userNameDisplay', 'userNameDisplayMobile'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = nameToShow;
        });
    }

    // ==========================================
    // 2.1 Status Helpers
    // ==========================================
    function normalizeStatus(s) { return String(s || '').trim().toUpperCase(); }
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

    function isDeleted(obj) {
        if (!obj) return true;
        const v = obj.is_deleted;
        return v === true || v === 'true';
    }

    function isPaid(inv) {
        const v = getField(inv, 'is_paid', 'paid');
        return v === true || v === 'true' || v === 1 || v === '1';
    }

    function isRoomOccupied(r) { return normalizeRoomStatus(getField(r, 'status', 'room_status')) === 'OCCUPIED'; }
    function isRoomAvailable(r) { return normalizeRoomStatus(getField(r, 'status', 'room_status')) === 'AVAILABLE'; }
    function isRoomBooked(r) { return normalizeRoomStatus(getField(r, 'status', 'room_status')) === 'BOOKED'; }

    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        return text ? JSON.parse(text) : [];
    }

    // ==========================================
    // 3. Badge
    // ==========================================
    function updateBadge(elementId, count) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const num = Number(count) || 0;
        if (num > 0) {
            el.innerText = num > 99 ? '99+' : num;
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    }

    async function loadPendingCounts() {
        try {
            const buildingId = getCurrentBuildingId();
            const url = buildingId ? `${API_BASE}/pending-counts?building_id=${buildingId}` : `${API_BASE}/pending-counts`;
            const response = await fetch(url);
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : {};
            const data = toObject(parsed);
            updateBadge('badgeBookings', data.pending_bookings);
            updateBadge('badgePayments', data.pending_payments);
        } catch (error) {
            console.warn('⚠️ โหลด Badge ล้มเหลว:', error.message);
        }
    }

    // ==========================================
    // 4. Building Selector
    // ==========================================
    async function initBuildingSelector() {
        const selector = document.getElementById('buildingSelector');
        const listContainer = document.getElementById('buildingList');
        
        try {
            const response = await fetch(`${API_BASE}/buildings`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            const raw = text ? JSON.parse(text) : [];
            
            // ⭐ Filter อาคารที่ถูกลบ (soft delete)
            const buildings = toArray(raw).filter(b => 
                b.is_deleted !== true && b.is_deleted !== 'true'
            );

            console.log('🏢 อาคารที่แสดง:', buildings.length);

            if (selector) {
                selector.innerHTML = '';
                if (buildings.length === 0) {
                    selector.innerHTML = '<option value="">ยังไม่มีอาคาร</option>';
                } else {
                    buildings.forEach(b => {
                        const option = document.createElement('option');
                        option.value = b.building_id;
                        option.textContent = b.building_name;
                        selector.appendChild(option);
                    });
                    const savedId = localStorage.getItem('selected_building_id');
                    if (savedId && buildings.find(b => b.building_id == savedId)) {
                        selector.value = savedId;
                    } else {
                        const first = buildings[0];
                        localStorage.setItem('selected_building_id', first.building_id);
                        localStorage.setItem('selected_building_name', first.building_name);
                        selector.value = first.building_id;
                    }
                }
            }

            if (listContainer) {
                if (buildings.length === 0) {
                    listContainer.innerHTML = '<p class="text-gray-400 text-sm col-span-full">ยังไม่มีอาคารในระบบ</p>';
                } else {
                    listContainer.innerHTML = '';
                    buildings.forEach(b => {
                        const card = document.createElement('div');
                        card.className = 'border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition';
                        const safeName = escapeHtml(b.building_name || '').replace(/'/g, "\\'");
                        card.innerHTML = `
                            <div class="flex justify-between items-start gap-2">
                                <div class="flex-1 min-w-0">
                                    <p class="font-semibold text-gray-800 truncate">${escapeHtml(b.building_name)}</p>
                                    <p class="text-xs text-gray-500 truncate mt-1">${escapeHtml(b.address || 'ไม่มีที่อยู่')}</p>
                                </div>
                                <button onclick="deleteBuilding(${b.building_id}, '${safeName}')" 
                                        class="text-red-500 hover:bg-red-50 p-1.5 rounded transition shrink-0"
                                        title="ลบอาคาร">🗑️</button>
                            </div>
                        `;
                        listContainer.appendChild(card);
                    });
                }
            }

            const subtitle = document.getElementById('dashboardSubtitle');
            if (subtitle) {
                const bn = getCurrentBuildingName();
                subtitle.innerText = bn ? `ข้อมูลของ ${bn}` : 'ประจำเดือน กันยายน 2569';
            }
        } catch (error) {
            console.error("❌ โหลดข้อมูลอาคารล้มเหลว:", error);
            if (selector) selector.innerHTML = '<option value="">โหลดล้มเหลว</option>';
        }
    }

    function setupBuildingListener() {
        const selector = document.getElementById('buildingSelector');
        if (!selector) return;
        selector.addEventListener('change', function(e) {
            const selectedId = e.target.value;
            const selectedName = e.target.options[e.target.selectedIndex].text;
            localStorage.setItem('selected_building_id', selectedId);
            localStorage.setItem('selected_building_name', selectedName);
            const subtitle = document.getElementById('dashboardSubtitle');
            if (subtitle) subtitle.innerText = `ข้อมูลของ ${selectedName}`;
            refreshDashboard();
            loadPendingCounts();
        });
    }

    // ==========================================
    // 5. Refresh Dashboard
    // ==========================================
    async function refreshDashboard() {
        const btn = document.getElementById('refreshBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="animate-spin inline-block">🔄</span> กำลังโหลด';
        }

        try {
            const buildingId = getCurrentBuildingId();
            if (!buildingId) {
                console.warn('⚠️ ยังไม่ได้เลือกอาคาร');
                return;
            }

            const [roomsRaw, paymentsRaw, bookingsRaw] = await Promise.all([
                fetchJson(`${API_BASE}/rooms?building_id=${buildingId}`).catch(() => []),
                fetchJson(`${API_BASE}/payments?building_id=${buildingId}`).catch(() => []),
                fetchJson(`${API_BASE}/bookings?building_id=${buildingId}`).catch(() => [])
            ]);

            const rooms = toArray(roomsRaw).filter(r => !isDeleted(r));
            const payments = toArray(paymentsRaw).filter(p => !isDeleted(p));
            const bookings = toArray(bookingsRaw).filter(b => !isDeleted(b));

            const occupiedCount = rooms.filter(isRoomOccupied).length;
            const totalRooms = rooms.length;

            const bookedRooms = rooms.filter(isRoomBooked);
            const pendingBookings = bookings.filter(b => {
                const s = normalizeStatus(b.status);
                return s === 'PENDING' || s === 'WAITING' || s === 'PENDING_DEPOSIT' || s === 'BOOKED';
            });
            const pendingDepositCount = pendingBookings.length > 0 ? pendingBookings.length : bookedRooms.length;

            const unpaidPayments = payments.filter(p => !isPaid(p));
            const uniqueUnpaidRooms = new Set();
            unpaidPayments.forEach(p => {
                const key = getField(p, 'room_number', 'room_no', 'room_id');
                if (key !== null && key !== undefined && key !== '') {
                    uniqueUnpaidRooms.add(String(key));
                }
            });

            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
            const currentYearMonth = `${currentYear}-${currentMonth}`;
            
            let paidThisMonth = payments.filter(p => {
                if (!isPaid(p)) return false;
                const pd = getField(p, 'paid_date');
                return pd && String(pd).startsWith(currentYearMonth);
            });

            if (paidThisMonth.length === 0) {
                const billingMonths = [...new Set(
                    payments.filter(p => isPaid(p)).map(p => getField(p, 'billing_month')).filter(Boolean)
                )].sort().reverse();
                
                if (billingMonths.length > 0) {
                    const latestMonth = billingMonths[0];
                    paidThisMonth = payments.filter(p => {
                        if (!isPaid(p)) return false;
                        return String(getField(p, 'billing_month') || '') === latestMonth;
                    });
                }
            }

            const totalRevenue = paidThisMonth.reduce((sum, p) => {
                return sum + (parseFloat(getField(p, 'paid_amount', 'total_amount')) || 0);
            }, 0);

            updateStatCard('statOccupied', occupiedCount);
            updateStatCard('statTotalRooms', totalRooms);
            updateStatCard('statUnpaid', pendingDepositCount);
            updateStatCard('statUnpaidRooms', uniqueUnpaidRooms.size);
            updateStatCard('statRevenue', formatNumber(totalRevenue));

            const availableRooms = rooms.filter(isRoomAvailable);
            renderVacantRooms(availableRooms);
            renderWarnings(rooms, payments, bookings);
            loadPendingCounts();
            
        } catch (error) {
            console.error("❌ Dashboard error:", error);
            showNotification('❌ โหลดแดชบอร์ดไม่สำเร็จ', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span>🔄</span> รีเฟรช';
            }
        }
    }

    // ==========================================
    // 6. Render Warnings
    // ==========================================
    function renderWarnings(rooms, payments, bookings) {
        const container = document.getElementById('warningsTableBody') || findWarningsTbody();
        if (!container) return;

        const warnings = [];
        const now = new Date();

        rooms.filter(isRoomBooked).forEach(r => {
            warnings.push({
                type: '📅 รอชำระมัดจำ',
                detail: `ห้อง ${r.room_number || '-'} (${r.room_type || '-'}) — รอลูกค้าจ่ายมัดจำ`,
                level: 'warning',
                action: `<a href="bookings.html" class="text-blue-600 hover:underline text-xs">ดูการจอง →</a>`
            });
        });

        payments.filter(p => !isPaid(p)).forEach(p => {
            const dueDate = getField(p, 'due_date');
            let overdueDays = 0;
            if (dueDate) {
                const d = new Date(dueDate);
                if (!isNaN(d.getTime())) {
                    overdueDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
                }
            }

            const roomNo = getField(p, 'room_number', 'room_no') || '-';
            const tenant = getField(p, 'tenant_name', 'tenant') || '-';
            const amt = parseFloat(getField(p, 'total_amount', 'amount')) || 0;

            let label = '';
            if (overdueDays > 0) label = ` (เลย ${overdueDays} วัน)`;
            else if (dueDate) label = ' (ยังไม่ถึงกำหนด)';

            warnings.push({
                type: overdueDays > 0 ? '💰 ค้างชำระ' : '💵 รอชำระ',
                detail: `ห้อง ${roomNo} — ${tenant} • ${formatNumber(amt)} ฿${label}`,
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
    // 7. Render ห้องว่าง
    // ==========================================
    function renderVacantRooms(vacantList) {
        const container = document.getElementById('vacantRoomList');
        if (!container) return;

        if (!Array.isArray(vacantList) || vacantList.length === 0) {
            container.innerHTML = '<p class="text-gray-400 text-sm text-center py-4">ไม่มีห้องว่าง</p>';
            return;
        }

        const sorted = [...vacantList].sort((a, b) => 
            String(a.room_number || '').localeCompare(String(b.room_number || ''), 'th', { numeric: true })
        );

        container.innerHTML = '';
        sorted.forEach(room => {
            const div = document.createElement('div');
            div.className = 'flex justify-between items-center p-3 border border-gray-100 rounded-lg hover:border-blue-200 transition bg-gray-50/50';
            div.innerHTML = `
                <div>
                    <p class="font-bold text-gray-800">${escapeHtml(room.room_number || '-')}</p>
                    <p class="text-xs text-gray-500">${escapeHtml(room.room_type || '-')} • ${formatNumber(room.default_price)} ฿</p>
                </div>
                <span class="text-green-500 font-medium text-sm">ว่าง</span>
            `;
            container.appendChild(div);
        });
    }

    function updateStatCard(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    }

    // ==========================================
    // 8. Modal เพิ่มอาคาร
    // ==========================================
    function openAddBuildingModal() {
        const modal = document.getElementById('addBuildingModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => document.getElementById('buildingName')?.focus(), 100);
    }

    function closeAddBuildingModal() {
        const modal = document.getElementById('addBuildingModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.getElementById('addBuildingForm')?.reset();
    }

    function setupAddBuildingForm() {
        const form = document.getElementById('addBuildingForm');
        if (!form) return;

        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const btnText = document.getElementById('saveBtnText');
            const submitBtn = form.querySelector('button[type="submit"]');
            const buildingName = document.getElementById('buildingName').value.trim();
            const buildingAddress = document.getElementById('buildingAddress').value.trim();

            if (!buildingName) { showNotification('⚠️ กรุณากรอกชื่ออาคาร', 'error'); return; }

            btnText.innerText = 'กำลังบันทึก...';
            submitBtn.disabled = true;

            try {
                const response = await fetch(`${API_BASE}/buildings-create`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ building_name: buildingName, address: buildingAddress })
                });
                const text = await response.text();
                let data = {};
                try { data = text ? JSON.parse(text) : {}; } catch(_) {}

                if (response.ok) {
                    closeAddBuildingModal();
                    showNotification('✅ เพิ่มอาคารสำเร็จ!', 'success');
                    setTimeout(async () => {
                        await initBuildingSelector();
                        await refreshDashboard();
                    }, 500);
                } else {
                    throw new Error(data.message || `HTTP ${response.status}`);
                }
            } catch (error) {
                console.error('❌ เพิ่มอาคารล้มเหลว:', error);
                showNotification('❌ ' + error.message, 'error');
            } finally {
                btnText.innerText = 'บันทึก';
                submitBtn.disabled = false;
            }
        });
    }

    // ==========================================
    // 9. ⭐ ลบอาคาร (Soft Delete)
    // ==========================================
    async function deleteBuilding(id, name) {
        if (!confirm(`⚠️ ต้องการลบ "${name}" ใช่หรือไม่?\n\nℹ️ ข้อมูลห้อง/สัญญา/ผู้เช่าในอาคารนี้จะยังอยู่\nแต่จะไม่แสดงในระบบ`)) return;

        try {
            const response = await fetch(`${API_BASE}/buildings-delete?id=${id}`, {
                method: 'DELETE'
            });
            const text = await response.text();

            console.log('📥 Response:', response.status, text);

            // ⭐ ถ้า response ว่างเปล่า หรือ 200 OK → ถือว่าสำเร็จ
            if (response.ok && (!text || text.trim() === '' || text === '[]')) {
                showNotification('🗑️ ลบอาคารสำเร็จ', 'success');
                if (getCurrentBuildingId() == id) {
                    localStorage.removeItem('selected_building_id');
                    localStorage.removeItem('selected_building_name');
                }
                setTimeout(async () => {
                    await initBuildingSelector();
                    await refreshDashboard();
                }, 500);
                return;
            }

            // ⭐ parse JSON และเช็ค result.success
            let raw = null;
            try { raw = text ? JSON.parse(text) : null; } catch(_) {}
            const result = toObject(raw);

            if (response.ok && (result.success === undefined || result.success === true)) {
                showNotification('🗑️ ลบอาคารสำเร็จ', 'success');
                if (getCurrentBuildingId() == id) {
                    localStorage.removeItem('selected_building_id');
                    localStorage.removeItem('selected_building_name');
                }
                setTimeout(async () => {
                    await initBuildingSelector();
                    await refreshDashboard();
                }, 500);
            } else {
                throw new Error(result.message || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ ลบอาคารล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        }
    }

    async function deleteCurrentBuilding() {
        const id = getCurrentBuildingId();
        const name = getCurrentBuildingName();
        if (!id) { showNotification('⚠️ กรุณาเลือกอาคารก่อน', 'error'); return; }
        deleteBuilding(id, name);
    }

    // ==========================================
    // 10. Mobile Menu
    // ==========================================
    function setupMobileMenu() {
        const menuToggle = document.getElementById('menuToggle');
        const closeSidebar = document.getElementById('closeSidebar');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (!menuToggle || !sidebar || !overlay) return;

        menuToggle.addEventListener('click', () => {
            sidebar.classList.remove('-translate-x-full');
            overlay.classList.remove('hidden');
        });

        const closeMenu = () => {
            sidebar.classList.add('-translate-x-full');
            overlay.classList.add('hidden');
        };

        overlay.addEventListener('click', closeMenu);
        closeSidebar?.addEventListener('click', closeMenu);
    }

    // ==========================================
    // 11. Logout
    // ==========================================
    function logout() {
        if (!confirm('ต้องการออกจากระบบใช่หรือไม่?')) return;
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_username');
        window.location.href = 'login.html';
    }

    // ==========================================
    // 12. Export to window
    // ==========================================
    window.openAddBuildingModal = openAddBuildingModal;
    window.closeAddBuildingModal = closeAddBuildingModal;
    window.refreshDashboard = refreshDashboard;
    window.deleteBuilding = deleteBuilding;
    window.deleteCurrentBuilding = deleteCurrentBuilding;
    window.logout = logout;
    window.getCurrentBuildingId = getCurrentBuildingId;
    window.getCurrentBuildingName = getCurrentBuildingName;
    window.loadPendingCounts = loadPendingCounts;
    window.showNotification = showNotification;
    window.toArray = toArray;
    window.toObject = toObject;
    window.formatNumber = formatNumber;
    window.escapeHtml = escapeHtml;

    // ==========================================
    // 13. Init
    // ==========================================
    document.addEventListener("DOMContentLoaded", function() {
        displayUsername();
        initBuildingSelector();
        setupBuildingListener();
        setupMobileMenu();
        setupAddBuildingForm();
        refreshDashboard();

        setTimeout(displayUsername, 100);
        setTimeout(displayUsername, 500);

        console.log('✅ app.js v7 โหลดสำเร็จ');
    });

})();
