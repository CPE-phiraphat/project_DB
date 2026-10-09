/* ==========================================
 * tenants.js - จัดการข้อมูลผู้เช่า (v10)
 * ⭐ v10: ใช้ building_id filter + UPPERCASE status + normalize
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'https://n8n_mirot.minmark.xyz/webhook';

    let allTenants = [];
    let currentEditingTenantId = null;
    let deletingTenantId = null;
    let lastBuildingId = '';
    let isLoading = false;

    const showNotification = window.showNotification;
    const escapeHtml = window.escapeHtml;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

    // ==========================================
    // Helper: Normalize Status
    // ==========================================
    function normalizeStatus(s) {
        return String(s || '').trim().toUpperCase();
    }

    function normalizeContractStatus(s) {
        const u = normalizeStatus(s);
        if (u === 'ACTIVE') return 'ACTIVE';
        if (u === 'PENDING') return 'PENDING';
        if (u === 'TERMINATED' || u === 'CANCELLED' || u === 'ENDED') return 'TERMINATED';
        if (u === 'EXPIRED') return 'EXPIRED';
        return u;
    }

    function extractResult(raw) {
        if (raw === null || raw === undefined) return { success: false, message: 'Response ว่างเปล่า' };
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

    function formatIdCard(idCard) {
        if (!idCard) return '-';
        if (String(idCard).startsWith('TMP')) return '⏳ ชั่วคราว';
        const clean = String(idCard).replace(/\D/g, '');
        if (clean.length !== 13) return idCard;
        return `${clean[0]}-${clean.slice(1,5)}-${clean.slice(5,10)}-${clean.slice(10,12)}-${clean.slice(12)}`;
    }

    function calculateAge(birthDate) {
        if (!birthDate) return null;
        try {
            const birth = new Date(birthDate);
            if (isNaN(birth.getTime())) return null;
            const today = new Date();
            let age = today.getFullYear() - birth.getFullYear();
            const monthDiff = today.getMonth() - birth.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
            if (age < 0 || age > 150) return null;
            return age;
        } catch { return null; }
    }

    function renderAge(birthDate) {
        const age = calculateAge(birthDate);
        if (age === null) return '<span class="text-gray-400">-</span>';
        let color = 'text-gray-700';
        if (age < 18) color = 'text-orange-600';
        else if (age >= 60) color = 'text-blue-600';
        return `<span class="${color} font-medium">${age}</span> <span class="text-xs text-gray-400">ปี</span>`;
    }

    // ⭐ ตรวจสอบสถานะผู้เช่า
    function getTenantStatus(t) {
        const cs = normalizeContractStatus(t.contract_status);
        if (t.contract_id && cs === 'ACTIVE') return 'active';
        if (t.contract_id && cs === 'PENDING') return 'pending';
        if (t.booking_id) return 'pending';
        return 'none';
    }

    // ==========================================
    // 1. โหลด
    // ==========================================
    async function loadTenants() {
        const tbody = document.getElementById('tenantTableBody');
        if (!tbody || isLoading) return;
        isLoading = true;

        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">กำลังโหลดข้อมูล...</td></tr>';

        try {
            const buildingId = getCurrentBuildingId();
            if (!buildingId) {
                tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">กรุณาเลือกอาคารก่อน</td></tr>';
                isLoading = false;
                return;
            }

            const url = `${API_BASE}/tenants?building_id=${buildingId}&_t=${Date.now()}`;
            console.log('🌐 โหลดผู้เช่าจาก:', url);

            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            let tenants = toArray(parsed);
            
            allTenants = tenants.filter(t => t.is_deleted !== true && t.is_deleted !== 'true');
            
            console.log(`📦 โหลด ${tenants.length} คน → แสดง ${allTenants.length}`);
            
            renderTenants();
            
            const subtitle = document.getElementById('tenantSubtitle');
            if (subtitle) subtitle.innerText = `ผู้เช่าใน ${getCurrentBuildingName() || 'อาคารปัจจุบัน'}`;
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
    function renderTenants() {
        const tbody = document.getElementById('tenantTableBody');
        if (!tbody) return;

        const statusFilter = String(document.getElementById('statusFilter')?.value || '').toLowerCase();
        const searchQuery = (document.getElementById('searchTenant')?.value || '').trim().toLowerCase();

        let filtered = allTenants.filter(t => {
            const status = getTenantStatus(t);
            if (statusFilter === 'active' && status !== 'active') return false;
            if (statusFilter === 'pending' && status !== 'pending') return false;
            if (statusFilter === 'no_contract' && status !== 'none') return false;
            
            if (searchQuery) {
                const name = `${t.first_name || ''} ${t.last_name || ''}`.toLowerCase();
                const phone = String(t.phone || '').toLowerCase();
                const idCard = String(t.id_card || '').toLowerCase();
                if (!name.includes(searchQuery) && !phone.includes(searchQuery) && !idCard.includes(searchQuery)) return false;
            }
            return true;
        });

        filtered.sort((a, b) => (b.tenant_id || 0) - (a.tenant_id || 0));

        const countEl = document.getElementById('tenantCount');
        if (countEl) countEl.innerText = filtered.length;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">
                ${allTenants.length === 0 ? 'ยังไม่มีผู้เช่าในอาคารนี้' : 'ไม่พบผู้เช่าที่ตรงกับเงื่อนไข'}
            </td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(t => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition';

            const status = getTenantStatus(t);
            let statusBadge = '';
            
            if (status === 'active') {
                statusBadge = `<span class="px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium inline-block whitespace-nowrap">🟢 กำลังเช่า</span>`;
            } else if (status === 'pending') {
                const cs = normalizeContractStatus(t.contract_status);
                if (t.contract_id && cs === 'PENDING') {
                    statusBadge = `<span class="px-2.5 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium inline-block whitespace-nowrap">🟡 รอสัญญา</span>`;
                } else {
                    statusBadge = `<span class="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium inline-block whitespace-nowrap">📅 รอทำสัญญา</span>`;
                }
            } else {
                statusBadge = `<span class="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium inline-block whitespace-nowrap">⚪ ยังไม่มีสัญญา</span>`;
            }

            let roomInfo = '<span class="text-gray-400">-</span>';
            if (t.room_number) {
                roomInfo = `
                    <span class="font-bold text-blue-600">${escapeHtml(t.room_number)}</span>
                    <span class="block text-xs text-gray-400">${escapeHtml(t.building_name || '')}</span>
                `;
            }

            tr.innerHTML = `
                <td class="px-4 py-3">
                    <div class="font-medium text-gray-800">${escapeHtml(t.first_name || '')} ${escapeHtml(t.last_name || '')}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(t.occupation || '')}</div>
                </td>
                <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${escapeHtml(formatIdCard(t.id_card))}</td>
                <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${escapeHtml(t.phone || '-')}</td>
                <td class="px-4 py-3 whitespace-nowrap">${renderAge(t.birth_date)}</td>
                <td class="px-4 py-3">${roomInfo}</td>
                <td class="px-4 py-3">${statusBadge}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                    <button data-view-id="${t.tenant_id}" 
                            class="js-view-tenant bg-purple-100 hover:bg-purple-200 text-purple-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1">
                        👁️ รายละเอียด
                    </button>
                    <button data-edit-id="${t.tenant_id}" 
                            class="js-edit-tenant bg-blue-100 hover:bg-blue-200 text-blue-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1">
                        ✏️ แก้ไข
                    </button>
                    <button data-delete-id="${t.tenant_id}" 
                            class="js-delete-tenant bg-red-100 hover:bg-red-200 text-red-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition">
                        🗑️ ลบ
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.js-view-tenant').forEach(btn => {
            btn.addEventListener('click', function() {
                openViewTenantModal(parseInt(this.getAttribute('data-view-id')));
            });
        });
        tbody.querySelectorAll('.js-edit-tenant').forEach(btn => {
            btn.addEventListener('click', function() {
                openEditTenantModal(parseInt(this.getAttribute('data-edit-id')));
            });
        });
        tbody.querySelectorAll('.js-delete-tenant').forEach(btn => {
            btn.addEventListener('click', function() {
                const id = parseInt(this.getAttribute('data-delete-id'));
                const tenant = allTenants.find(x => Number(x.tenant_id) === id);
                openDeleteTenantModal(id, `${tenant?.first_name || ''} ${tenant?.last_name || ''}`);
            });
        });
    }

    // ==========================================
    // 3. Modal Add
    // ==========================================
    function openAddTenantModal() {
        if (!getCurrentBuildingId()) {
            showNotification('⚠️ กรุณาเลือกอาคารก่อน', 'error');
            return;
        }
        currentEditingTenantId = null;
        document.getElementById('tenantModalTitle').innerText = 'เพิ่มผู้เช่าใหม่';
        document.getElementById('tenantForm').reset();
        document.getElementById('tenantId').value = '';
        document.getElementById('agePreview').innerText = '';
        
        const modal = document.getElementById('tenantModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => document.getElementById('firstName')?.focus(), 100);
    }

    // ==========================================
    // 4. Modal Edit
    // ==========================================
    function openEditTenantModal(tenantId) {
        const tenant = allTenants.find(t => Number(t.tenant_id) === Number(tenantId));
        if (!tenant) {
            showNotification('⚠️ ไม่พบข้อมูลผู้เช่า', 'error');
            return;
        }

        currentEditingTenantId = Number(tenantId);
        document.getElementById('tenantModalTitle').innerText = `แก้ไข: ${tenant.first_name || ''} ${tenant.last_name || ''}`;
        document.getElementById('tenantId').value = tenant.tenant_id;
        document.getElementById('firstName').value = tenant.first_name || '';
        document.getElementById('lastName').value = tenant.last_name || '';
        document.getElementById('idCard').value = tenant.id_card || '';
        document.getElementById('phone').value = tenant.phone || '';
        document.getElementById('birthDate').value = tenant.birth_date || '';
        document.getElementById('address').value = tenant.address || '';
        document.getElementById('occupation').value = tenant.occupation || '';
        document.getElementById('workplace').value = tenant.workplace || '';
        
        updateAgePreview();
        
        const modal = document.getElementById('tenantModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeTenantModal() {
        const modal = document.getElementById('tenantModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        currentEditingTenantId = null;
    }

    function updateAgePreview() {
        const birthDate = document.getElementById('birthDate')?.value;
        const preview = document.getElementById('agePreview');
        if (!preview) return;
        if (!birthDate) { preview.innerText = ''; return; }
        const age = calculateAge(birthDate);
        preview.innerText = age !== null ? `อายุ: ${age} ปี` : '';
    }

    // ==========================================
    // 5. View Modal
    // ==========================================
    function openViewTenantModal(tenantId) {
        const tenant = allTenants.find(t => Number(t.tenant_id) === Number(tenantId));
        if (!tenant) {
            showNotification('⚠️ ไม่พบข้อมูลผู้เช่า', 'error');
            return;
        }

        const firstChar = (tenant.first_name || '?').charAt(0).toUpperCase();
        document.getElementById('viewAvatar').innerText = firstChar;
        document.getElementById('viewTenantName').innerText = `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || 'ไม่ระบุชื่อ';
        document.getElementById('viewTenantId').innerText = `Tenant #${tenant.tenant_id}`;

        const status = getTenantStatus(tenant);
        let badge = '';
        if (status === 'active') badge = `<span class="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">🟢 กำลังเช่าอยู่</span>`;
        else if (status === 'pending') badge = `<span class="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium">🟡 รอทำสัญญา</span>`;
        else badge = `<span class="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">⚪ ยังไม่มีสัญญา</span>`;
        document.getElementById('viewStatusBadge').innerHTML = badge;

        document.getElementById('viewFullName').innerText = `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || '-';
        document.getElementById('viewIdCard').innerText = formatIdCard(tenant.id_card);
        
        if (tenant.birth_date) {
            const d = new Date(tenant.birth_date);
            document.getElementById('viewBirthDate').innerText = !isNaN(d.getTime()) 
                ? d.toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' })
                : '-';
        } else {
            document.getElementById('viewBirthDate').innerText = '-';
        }

        const age = calculateAge(tenant.birth_date);
        document.getElementById('viewAge').innerText = age !== null ? `${age} ปี` : '-';
        document.getElementById('viewPhone').innerText = tenant.phone || '-';
        document.getElementById('viewOccupation').innerText = tenant.occupation || '-';
        document.getElementById('viewWorkplace').innerText = tenant.workplace || '-';
        document.getElementById('viewAddress').innerText = tenant.address || '-';
        document.getElementById('viewBuilding').innerText = tenant.building_name || '-';
        document.getElementById('viewRoom').innerText = tenant.room_number || '-';
        document.getElementById('viewRoomType').innerText = tenant.room_type || '-';

        if (tenant.created_at) {
            const d = new Date(tenant.created_at);
            document.getElementById('viewCreatedAt').innerText = !isNaN(d.getTime())
                ? d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '-';
        } else {
            document.getElementById('viewCreatedAt').innerText = '-';
        }
        document.getElementById('viewTenantIdValue').innerText = `#${tenant.tenant_id}`;

        document.getElementById('viewEditBtn').onclick = function() {
            closeViewTenantModal();
            setTimeout(() => openEditTenantModal(Number(tenantId)), 200);
        };

        const modal = document.getElementById('viewTenantModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeViewTenantModal() {
        const modal = document.getElementById('viewTenantModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    // ==========================================
    // 6. บันทึก
    // ==========================================
    async function saveTenantData(e) {
        if (e) e.preventDefault();

        const btnText = document.getElementById('saveTenantBtnText');
        const submitBtn = document.getElementById('saveTenantBtn');
        
        const firstName = document.getElementById('firstName').value.trim();
        const lastName = document.getElementById('lastName').value.trim();
        const idCard = document.getElementById('idCard').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const birthDate = document.getElementById('birthDate').value;
        const address = document.getElementById('address').value.trim();
        const occupation = document.getElementById('occupation').value.trim();
        const workplace = document.getElementById('workplace').value.trim();
        const buildingId = getCurrentBuildingId();

        if (!firstName) return showNotification('⚠️ กรุณากรอกชื่อ', 'error');
        if (idCard && idCard.length !== 13) return showNotification('⚠️ เลขบัตรประชาชนต้องมี 13 หลัก', 'error');
        if (!buildingId) return showNotification('⚠️ ไม่พบอาคารปัจจุบัน', 'error');

        btnText.innerText = 'กำลังบันทึก...';
        submitBtn.disabled = true;

        try {
            const isEdit = currentEditingTenantId !== null;
            const endpoint = isEdit ? `${API_BASE}/tenants-update` : `${API_BASE}/tenants-create`;
            
            const payload = {
                first_name: firstName,
                last_name: lastName,
                id_card: idCard,
                phone: phone,
                birth_date: birthDate || null,
                address: address || null,
                occupation: occupation || null,
                workplace: workplace || null,
                building_id: parseInt(buildingId)  // ⭐ ส่ง building_id
            };
            if (isEdit) payload.tenant_id = currentEditingTenantId;

            console.log('📤 บันทึกผู้เช่า:', payload);

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
                closeTenantModal();
                showNotification(isEdit ? '✅ แก้ไขสำเร็จ!' : '✅ เพิ่มสำเร็จ!', 'success');
                setTimeout(async () => { await loadTenants(); }, 500);
                setTimeout(async () => { await loadTenants(); }, 1500);
            } else {
                throw new Error(result.message || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ ล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btnText.innerText = 'บันทึก';
            submitBtn.disabled = false;
        }
    }

    // ==========================================
    // 7. Delete
    // ==========================================
    function openDeleteTenantModal(tenantId, tenantName) {
        deletingTenantId = tenantId;
        document.getElementById('deleteTenantName').innerText = tenantName || 'ไม่ระบุ';
        const modal = document.getElementById('deleteTenantModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeDeleteTenantModal() {
        const modal = document.getElementById('deleteTenantModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        deletingTenantId = null;
    }

    async function confirmDeleteTenant() {
        if (!deletingTenantId) return;

        const btn = document.getElementById('confirmDeleteTenantBtn');
        btn.disabled = true;
        btn.innerText = 'กำลังลบ...';

        try {
            const response = await fetch(`${API_BASE}/tenants-delete?id=${deletingTenantId}`, { method: 'DELETE' });
            const text = await response.text();

            if (!text || text.trim() === '' || text === '[]') {
                await new Promise(r => setTimeout(r, 800));
                await loadTenants();
                const stillExists = allTenants.find(t => Number(t.tenant_id) === Number(deletingTenantId));
                if (!stillExists) {
                    closeDeleteTenantModal();
                    showNotification('🗑️ ลบสำเร็จ', 'success');
                } else {
                    throw new Error('ไม่สามารถลบได้ (อาจมีสัญญาเช่าอยู่)');
                }
                return;
            }

            let raw = null;
            try { raw = JSON.parse(text); } catch(e) { throw new Error('Response ไม่ใช่ JSON'); }
            const result = extractResult(raw);

            if (response.ok && result.success === true) {
                closeDeleteTenantModal();
                showNotification('🗑️ ลบสำเร็จ', 'success');
                allTenants = allTenants.filter(t => Number(t.tenant_id) !== Number(deletingTenantId));
                renderTenants();
                setTimeout(async () => { await loadTenants(); }, 800);
            } else {
                throw new Error(result.message || 'ไม่สามารถลบได้');
            }
        } catch (error) {
            console.error('❌ ลบล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerText = 'ลบผู้เช่า';
        }
    }

    // ==========================================
    // 8. Filters
    // ==========================================
    function setupFilters() {
        const statusFilter = document.getElementById('statusFilter');
        const search = document.getElementById('searchTenant');
        
        if (statusFilter) statusFilter.addEventListener('change', renderTenants);
        if (search) {
            search.addEventListener('input', () => {
                clearTimeout(window._tenantSearchTimer);
                window._tenantSearchTimer = setTimeout(renderTenants, 200);
            });
        }
        const birthInput = document.getElementById('birthDate');
        if (birthInput) birthInput.addEventListener('change', updateAgePreview);
    }

    // ==========================================
    // 9. Export
    // ==========================================
    window.openAddTenantModal = openAddTenantModal;
    window.openEditTenantModal = openEditTenantModal;
    window.closeTenantModal = closeTenantModal;
    window.openDeleteTenantModal = openDeleteTenantModal;
    window.closeDeleteTenantModal = closeDeleteTenantModal;
    window.openViewTenantModal = openViewTenantModal;
    window.closeViewTenantModal = closeViewTenantModal;
    window.loadTenants = loadTenants;

    // ==========================================
    // 10. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 tenants.js v10 เริ่มทำงาน');
        setTimeout(() => { loadTenants(); }, 300);

        const form = document.getElementById('tenantForm');
        if (form) form.addEventListener('submit', saveTenantData);

        const confirmBtn = document.getElementById('confirmDeleteTenantBtn');
        if (confirmBtn) confirmBtn.addEventListener('click', confirmDeleteTenant);

        setupFilters();

        window.addEventListener('buildingChanged', () => loadTenants());
        
        lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const currentId = getCurrentBuildingId();
            if (currentId !== lastBuildingId) {
                lastBuildingId = currentId;
                loadTenants();
            }
        }, 1000);

        console.log('✅ tenants.js v10 โหลดสำเร็จ');
    });

})();
