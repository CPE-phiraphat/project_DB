/* ==========================================
 * invoices.js - จัดการใบแจ้งหนี้ (v10)
 * ⭐ v10: แสดงราคาเหมาจ่ายใน Billing Preview (แทนมิเตอร์)
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'http://n8n_mirot.minmark.xyz/webhook';

    let allInvoices = [];
    let allContracts = [];
    let currentEditingInvoiceId = null;
    let deletingInvoiceId = null;
    let lastBuildingId = '';
    let isLoading = false;
    let selectedContract = null;

    // State สำหรับ Billing Preview
    let billingPreviewData = [];
    let billingSelected = new Set();

    const showNotification = window.showNotification;
    const escapeHtml = window.escapeHtml;
    const formatNumber = window.formatNumber;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

    // ==========================================
    // Helper: Normalize
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

    function getInvoiceStatus(inv) {
        if (isPaidValue(inv.is_paid)) return 'paid';
        if (inv.due_date) {
            const days = daysBetween(new Date(), inv.due_date);
            if (days < 0) return 'overdue';
        }
        return 'unpaid';
    }

    function getStatusBadge(status) {
        const badges = {
            'paid':    { label: 'ชำระแล้ว',    cls: 'bg-green-100 text-green-700',  icon: '🟢' },
            'unpaid':  { label: 'ยังไม่ชำระ', cls: 'bg-red-100 text-red-700',      icon: '🔴' },
            'overdue': { label: 'เลยกำหนด',    cls: 'bg-yellow-100 text-yellow-700', icon: '🟡' }
        };
        const cfg = badges[status] || badges['unpaid'];
        return `<span class="px-2.5 py-1 ${cfg.cls} rounded-full text-xs font-medium inline-block whitespace-nowrap">${cfg.icon} ${cfg.label}</span>`;
    }

    // ⭐ Helper: หาชั้นจากเลขห้อง
    function getFloor(roomNumber) {
        const num = parseInt(String(roomNumber || '').replace(/\D/g, ''), 10);
        if (isNaN(num)) return 0;
        return Math.floor(num / 100);
    }

    // ==========================================
    // 1. โหลด Invoices
    // ==========================================
    async function loadInvoices() {
        const tbody = document.getElementById('invoiceTableBody');
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

            const url = `${API_BASE}/invoices?building_id=${buildingId}&_t=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            let invoices = toArray(parsed);
            
            allInvoices = invoices.filter(i => i.is_deleted !== true && i.is_deleted !== 'true');
            
            console.log(`📦 โหลด ${allInvoices.length} ใบแจ้งหนี้`);
            renderInvoices();
            
            const subtitle = document.getElementById('invoiceSubtitle');
            if (subtitle) subtitle.innerText = `ใบแจ้งหนี้ใน ${getCurrentBuildingName() || 'อาคารปัจจุบัน'}`;
        } catch (error) {
            console.error('❌ โหลดล้มเหลว:', error);
            tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-red-500">⚠️ ${escapeHtml(error.message)}</td></tr>`;
        } finally {
            isLoading = false;
        }
    }

    // ==========================================
    // 2. Render Invoices
    // ==========================================
    function renderInvoices() {
        const tbody = document.getElementById('invoiceTableBody');
        if (!tbody) return;

        const statusFilter = document.getElementById('statusFilter')?.value || '';
        const monthFilter = document.getElementById('monthFilter')?.value || '';
        const searchQuery = (document.getElementById('searchInvoice')?.value || '').trim().toLowerCase();

        let filtered = allInvoices.filter(inv => {
            const status = getInvoiceStatus(inv);
            if (statusFilter && status !== statusFilter) return false;
            if (monthFilter && String(inv.billing_month || '') !== monthFilter) return false;
            if (searchQuery) {
                const name = String(inv.tenant_name || '').toLowerCase();
                const room = String(inv.room_number || '').toLowerCase();
                const volNo = String(inv.vol_no || '').toLowerCase();
                if (!name.includes(searchQuery) && !room.includes(searchQuery) && !volNo.includes(searchQuery)) return false;
            }
            return true;
        });

        filtered.sort((a, b) => (b.invoice_id || 0) - (a.invoice_id || 0));

        const countEl = document.getElementById('invoiceCount');
        if (countEl) countEl.innerText = filtered.length;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">
                ${allInvoices.length === 0 ? 'ยังไม่มีใบแจ้งหนี้ในอาคารนี้' : 'ไม่พบใบแจ้งหนี้ที่ตรงกับเงื่อนไข'}
            </td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(inv => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition';

            const status = getInvoiceStatus(inv);
            const statusBadge = getStatusBadge(status);

            let dueDateHtml = formatDate(inv.due_date);
            if (status === 'overdue') {
                const days = Math.abs(daysBetween(new Date(), inv.due_date));
                dueDateHtml += `<span class="block text-xs text-red-600 font-medium mt-1">(เลย ${days} วัน)</span>`;
            }

            tr.innerHTML = `
                <td class="px-4 py-3"><span class="font-bold text-blue-700 text-sm">${escapeHtml(inv.vol_no || '-')}</span></td>
                <td class="px-4 py-3">
                    <span class="font-bold text-blue-600">${escapeHtml(inv.room_number || '-')}</span>
                    <span class="block text-xs text-gray-400">${escapeHtml(inv.room_type || '')}</span>
                </td>
                <td class="px-4 py-3">
                    <div class="font-medium text-gray-800">${escapeHtml(inv.tenant_name || '-')}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(inv.tenant_phone || '')}</div>
                </td>
                <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${escapeHtml(inv.billing_month || '-')}</td>
                <td class="px-4 py-3 font-bold text-gray-800 whitespace-nowrap">${formatNumber(inv.total_amount)} ฿</td>
                <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${dueDateHtml}</td>
                <td class="px-4 py-3">${statusBadge}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                    <button data-view-id="${inv.invoice_id}" class="js-view-invoice bg-purple-100 hover:bg-purple-200 text-purple-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1">👁️ ดู</button>
                    <button data-edit-id="${inv.invoice_id}" class="js-edit-invoice bg-blue-100 hover:bg-blue-200 text-blue-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1">✏️ แก้ไข</button>
                    <button data-delete-id="${inv.invoice_id}" class="js-delete-invoice bg-red-100 hover:bg-red-200 text-red-700 px-2.5 py-1.5 rounded-md text-xs font-medium transition">🗑️ ลบ</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.js-view-invoice').forEach(btn => {
            btn.addEventListener('click', function() { openViewInvoiceModal(parseInt(this.getAttribute('data-view-id'))); });
        });
        tbody.querySelectorAll('.js-edit-invoice').forEach(btn => {
            btn.addEventListener('click', function() { openEditInvoiceModal(parseInt(this.getAttribute('data-edit-id'))); });
        });
        tbody.querySelectorAll('.js-delete-invoice').forEach(btn => {
            btn.addEventListener('click', function() {
                const id = parseInt(this.getAttribute('data-delete-id'));
                const inv = allInvoices.find(x => Number(x.invoice_id) === id);
                openDeleteInvoiceModal(id, inv?.tenant_name || '');
            });
        });
    }

    // ==========================================
    // 3. Search Contract
    // ==========================================
    async function loadContractsForSearch() {
        try {
            const buildingId = getCurrentBuildingId();
            const url = `${API_BASE}/contracts?building_id=${buildingId}&_t=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            allContracts = toArray(parsed).filter(c => c.is_deleted !== true && c.is_deleted !== 'true');
            return allContracts.filter(c => normalizeContractStatus(c.status) === 'ACTIVE');
        } catch (error) {
            console.error('❌ โหลดสัญญาล้มเหลว:', error);
            return [];
        }
    }

    function setupContractSearch() {
        const input = document.getElementById('contractSearch');
        const results = document.getElementById('contractResults');
        const selectedLabel = document.getElementById('contractSelected');
        if (!input || !results) return;

        input.addEventListener('input', async function() {
            const q = this.value.trim().toLowerCase();
            if (q.length < 1) { results.classList.add('hidden'); return; }
            
            const available = await loadContractsForSearch();
            const matched = available.filter(c => {
                const name = String(c.tenant_name || '').toLowerCase();
                const room = String(c.room_number || '').toLowerCase();
                const contractNo = String(c.contract_number || '').toLowerCase();
                return name.includes(q) || room.includes(q) || contractNo.includes(q);
            }).slice(0, 20);
            
            if (matched.length === 0) {
                results.innerHTML = '<div class="p-3 text-sm text-gray-500 text-center">ไม่พบสัญญาที่ตรงกัน</div>';
                results.classList.remove('hidden');
                return;
            }
            
            results.innerHTML = '';
            matched.forEach(c => {
                const div = document.createElement('div');
                div.className = 'search-result-item p-3 border-b border-gray-100 cursor-pointer transition';
                
                let meterInfo = '';
                if (c.elec_charge_type === 'flat_rate') {
                    meterInfo += `⚡ เหมาจ่าย ${formatNumber(c.elec_flat_rate)} ฿ `;
                }
                if (c.water_charge_type === 'flat_rate') {
                    meterInfo += `💧 เหมาจ่าย ${formatNumber(c.water_flat_rate)} ฿`;
                }
                
                div.innerHTML = `
                    <div class="flex justify-between items-center">
                        <div>
                            <div class="font-bold text-blue-600">ห้อง ${escapeHtml(c.room_number)}</div>
                            <div class="text-sm font-medium text-gray-800">${escapeHtml(c.tenant_name || '')}</div>
                            <div class="text-xs text-gray-500">${escapeHtml(c.contract_number || '')} • ${escapeHtml(c.tenant_phone || '')}</div>
                            ${meterInfo ? `<div class="text-xs text-yellow-700 mt-1">${meterInfo}</div>` : ''}
                        </div>
                        <div class="text-right">
                            <div class="text-sm font-bold text-green-600">${formatNumber(c.rent_price)} ฿</div>
                            <div class="text-xs text-gray-400">ต่อเดือน</div>
                        </div>
                    </div>
                `;
                div.addEventListener('click', () => {
                    selectedContract = c;
                    document.getElementById('contractIdValue').value = c.contract_id;
                    document.getElementById('contractSearch').value = `ห้อง ${c.room_number} - ${c.tenant_name}`;
                    selectedLabel.innerText = `✓ เลือก: ห้อง ${c.room_number} - ${c.tenant_name}`;
                    
                    document.getElementById('roomPrice').value = c.rent_price || 0;
                    
                    if (c.elec_charge_type === 'flat_rate' && c.elec_flat_rate > 0) {
                        document.getElementById('elecFlatRate').value = c.elec_flat_rate;
                        document.getElementById('elecPrev').value = 0;
                        document.getElementById('elecCurr').value = 0;
                        document.getElementById('elecUnitPrice').value = 0;
                    } else {
                        document.getElementById('elecPrev').value = c.initial_elec_meter || 0;
                        document.getElementById('elecFlatRate').value = 0;
                    }
                    
                    if (c.water_charge_type === 'flat_rate' && c.water_flat_rate > 0) {
                        document.getElementById('waterFlatRate').value = c.water_flat_rate;
                        document.getElementById('waterPrev').value = 0;
                        document.getElementById('waterCurr').value = 0;
                        document.getElementById('waterUnitPrice').value = 0;
                    } else {
                        document.getElementById('waterPrev').value = c.initial_water_meter || 0;
                        document.getElementById('waterFlatRate').value = 0;
                    }
                    
                    results.classList.add('hidden');
                    
                    document.getElementById('elecFlatRate').dispatchEvent(new Event('input'));
                    document.getElementById('waterFlatRate').dispatchEvent(new Event('input'));
                    
                    recalcTotal();
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
    // 4. คำนวณยอดรวม (Manual Form)
    // ==========================================
    function recalcTotal() {
        const roomPrice = parseFloat(document.getElementById('roomPrice').value) || 0;
        const applianceRental = parseFloat(document.getElementById('applianceRental').value) || 0;
        const trashFee = parseFloat(document.getElementById('trashFee').value) || 0;
        
        const elecPrev = parseFloat(document.getElementById('elecPrev').value) || 0;
        const elecCurr = parseFloat(document.getElementById('elecCurr').value) || 0;
        const elecUnitPrice = parseFloat(document.getElementById('elecUnitPrice').value) || 0;
        const elecFlatRate = parseFloat(document.getElementById('elecFlatRate').value) || 0;
        
        let elecAmount = 0;
        if (elecFlatRate > 0) {
            elecAmount = elecFlatRate;
        } else {
            elecAmount = Math.max(elecCurr - elecPrev, 0) * elecUnitPrice;
        }
        document.getElementById('elecTotal').value = elecAmount.toFixed(2);
        
        const waterPrev = parseFloat(document.getElementById('waterPrev').value) || 0;
        const waterCurr = parseFloat(document.getElementById('waterCurr').value) || 0;
        const waterUnitPrice = parseFloat(document.getElementById('waterUnitPrice').value) || 0;
        const waterFlatRate = parseFloat(document.getElementById('waterFlatRate').value) || 0;
        
        let waterAmount = 0;
        if (waterFlatRate > 0) {
            waterAmount = waterFlatRate;
        } else {
            waterAmount = Math.max(waterCurr - waterPrev, 0) * waterUnitPrice;
        }
        document.getElementById('waterTotal').value = waterAmount.toFixed(2);
        
        const arrears = parseFloat(document.getElementById('arrears').value) || 0;
        const otherFees = parseFloat(document.getElementById('otherFees').value) || 0;
        const discount = parseFloat(document.getElementById('discount').value) || 0;
        const fine = parseFloat(document.getElementById('fine').value) || 0;
        
        const total = roomPrice + applianceRental + elecAmount + waterAmount + trashFee + arrears + otherFees + fine - discount;
        
        document.getElementById('totalAmount').value = total.toFixed(2);
        document.getElementById('totalAmountDisplay').innerText = formatNumber(total) + ' ฿';
    }

    function setupTotalCalculation() {
        const ids = ['roomPrice', 'applianceRental', 'trashFee', 'elecPrev', 'elecCurr', 'elecUnitPrice', 'elecFlatRate', 'waterPrev', 'waterCurr', 'waterUnitPrice', 'waterFlatRate', 'arrears', 'otherFees', 'discount', 'fine'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', recalcTotal);
        });
    }

    // ==========================================
    // 5. Setup Meter Override
    // ==========================================
    function setupMeterOverride() {
        const elecFlat = document.getElementById('elecFlatRate');
        const waterFlat = document.getElementById('waterFlatRate');
        
        function updateElecState() {
            if (!elecFlat) return;
            const flatVal = parseFloat(elecFlat.value) || 0;
            const isFlat = flatVal > 0;
            ['elecPrev', 'elecCurr', 'elecUnitPrice'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                if (isFlat) {
                    el.disabled = true;
                    el.classList.add('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
                    el.classList.remove('bg-white');
                } else {
                    el.disabled = false;
                    el.classList.remove('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
                    el.classList.add('bg-white');
                }
            });
            if (isFlat) {
                elecFlat.classList.add('bg-green-100', 'border-green-400', 'font-bold');
            } else {
                elecFlat.classList.remove('bg-green-100', 'border-green-400', 'font-bold');
            }
            recalcTotal();
        }
        
        function updateWaterState() {
            if (!waterFlat) return;
            const flatVal = parseFloat(waterFlat.value) || 0;
            const isFlat = flatVal > 0;
            ['waterPrev', 'waterCurr', 'waterUnitPrice'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                if (isFlat) {
                    el.disabled = true;
                    el.classList.add('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
                    el.classList.remove('bg-white');
                } else {
                    el.disabled = false;
                    el.classList.remove('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
                    el.classList.add('bg-white');
                }
            });
            if (isFlat) {
                waterFlat.classList.add('bg-green-100', 'border-green-400', 'font-bold');
            } else {
                waterFlat.classList.remove('bg-green-100', 'border-green-400', 'font-bold');
            }
            recalcTotal();
        }
        
        if (elecFlat) {
            elecFlat.addEventListener('input', updateElecState);
            elecFlat.addEventListener('change', updateElecState);
        }
        if (waterFlat) {
            waterFlat.addEventListener('input', updateWaterState);
            waterFlat.addEventListener('change', updateWaterState);
        }
    }

    // ==========================================
    // 6. Setup Due Date Status
    // ==========================================
    function setupDueDateStatus() {
        const dueDate = document.getElementById('dueDate');
        const statusEl = document.getElementById('dueDateStatus');
        if (!dueDate || !statusEl) return;
        
        function updateStatus() {
            if (!dueDate.value) { statusEl.innerText = ''; return; }
            const days = daysBetween(new Date(), dueDate.value);
            if (days < 0) {
                statusEl.innerText = `⚠️ เลยกำหนดมาแล้ว ${Math.abs(days)} วัน`;
                statusEl.className = 'text-xs font-medium mt-1 text-red-600';
            } else if (days === 0) {
                statusEl.innerText = `📅 ครบกำหนดวันนี้`;
                statusEl.className = 'text-xs font-medium mt-1 text-orange-600';
            } else if (days <= 3) {
                statusEl.innerText = `⏰ อีก ${days} วันจะครบกำหนด`;
                statusEl.className = 'text-xs font-medium mt-1 text-yellow-600';
            } else {
                statusEl.innerText = `📅 อีก ${days} วัน`;
                statusEl.className = 'text-xs font-medium mt-1 text-gray-500';
            }
        }
        
        dueDate.addEventListener('change', updateStatus);
        dueDate.addEventListener('input', updateStatus);
        updateStatus();
    }

    // ==========================================
    // 7. Setup Fine Reason
    // ==========================================
    function setupFineReason() {
        const fine = document.getElementById('fine');
        const reason = document.getElementById('fineReason');
        if (!fine || !reason) return;
        
        function updateHighlight() {
            const val = parseFloat(fine.value) || 0;
            if (val > 0) {
                reason.classList.add('border-red-400', 'bg-red-50', 'ring-2', 'ring-red-200');
                reason.classList.remove('border-red-200', 'bg-red-50/50');
                reason.placeholder = '⚠️ ต้องระบุเหตุผล เช่น ชำระล่าช้า 5 วัน';
            } else {
                reason.classList.remove('border-red-400', 'bg-red-50', 'ring-2', 'ring-red-200');
                reason.classList.add('border-red-200', 'bg-red-50/50');
                reason.placeholder = 'เช่น ชำระล่าช้า 5 วัน, ทำผิดกฎหอพัก...';
            }
        }
        
        fine.addEventListener('input', updateHighlight);
        fine.addEventListener('change', updateHighlight);
    }

    // ==========================================
    // 8. Modal Add
    // ==========================================
    function openAddInvoiceModal() {
        if (!getCurrentBuildingId()) { showNotification('⚠️ กรุณาเลือกอาคารก่อน', 'error'); return; }

        currentEditingInvoiceId = null;
        selectedContract = null;

        document.getElementById('invoiceModalTitle').innerText = 'ออกใบแจ้งหนี้ใหม่';
        document.getElementById('invoiceForm').reset();
        document.getElementById('invoiceId').value = '';
        document.getElementById('contractIdValue').value = '';
        document.getElementById('contractSearch').value = '';
        document.getElementById('contractSelected').innerText = '';
        
        const today = new Date();
        document.getElementById('issueDate').value = today.toISOString().split('T')[0];
        
        const due = new Date();
        due.setDate(due.getDate() + 10);
        document.getElementById('dueDate').value = due.toISOString().split('T')[0];
        
        document.getElementById('billingMonth').value = today.toISOString().slice(0, 7);
        
        recalcTotal();
        setupDueDateStatus();
        
        document.getElementById('elecFlatRate').dispatchEvent(new Event('input'));
        document.getElementById('waterFlatRate').dispatchEvent(new Event('input'));
        
        const modal = document.getElementById('invoiceModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    // ==========================================
    // 9. Modal Edit
    // ==========================================
    async function openEditInvoiceModal(invoiceId) {
        const inv = allInvoices.find(i => Number(i.invoice_id) === Number(invoiceId));
        if (!inv) { showNotification('⚠️ ไม่พบข้อมูล', 'error'); return; }

        currentEditingInvoiceId = Number(invoiceId);
        selectedContract = { contract_id: inv.contract_id, tenant_name: inv.tenant_name, room_number: inv.room_number };

        let contractData = null;
        try {
            const buildingId = getCurrentBuildingId();
            const url = `${API_BASE}/contracts?building_id=${buildingId}&_t=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            const contracts = toArray(parsed);
            contractData = contracts.find(c => Number(c.contract_id) === Number(inv.contract_id));
        } catch (e) {
            console.warn('⚠️ ไม่สามารถดึงสัญญา:', e);
        }

        document.getElementById('invoiceModalTitle').innerText = `แก้ไขใบแจ้งหนี้ ${inv.vol_no || ''}`;
        document.getElementById('invoiceId').value = inv.invoice_id;
        document.getElementById('contractIdValue').value = inv.contract_id;
        document.getElementById('contractSearch').value = `ห้อง ${inv.room_number} - ${inv.tenant_name}`;
        document.getElementById('contractSelected').innerText = `✓ เลือก: ห้อง ${inv.room_number} - ${inv.tenant_name}`;
        
        document.getElementById('billingMonth').value = inv.billing_month || '';
        document.getElementById('issueDate').value = inv.issue_date || '';
        document.getElementById('dueDate').value = inv.due_date || '';
        document.getElementById('roomPrice').value = inv.room_price || 0;
        document.getElementById('applianceRental').value = inv.appliance_rental || 0;
        document.getElementById('trashFee').value = inv.trash_fee || 0;
        document.getElementById('elecPrev').value = inv.elec_prev || 0;
        document.getElementById('elecCurr').value = inv.elec_curr || 0;
        document.getElementById('elecUnitPrice').value = inv.elec_unit_price || 0;
        document.getElementById('waterPrev').value = inv.water_prev || 0;
        document.getElementById('waterCurr').value = inv.water_curr || 0;
        document.getElementById('waterUnitPrice').value = inv.water_unit_price || 0;
        
        let elecFlatRate = inv.elec_flat_rate || 0;
        let waterFlatRate = inv.water_flat_rate || 0;
        
        if (contractData) {
            if (contractData.elec_charge_type === 'flat_rate' && elecFlatRate === 0) {
                elecFlatRate = contractData.elec_flat_rate || 0;
            }
            if (contractData.water_charge_type === 'flat_rate' && waterFlatRate === 0) {
                waterFlatRate = contractData.water_flat_rate || 0;
            }
        }
        
        document.getElementById('elecFlatRate').value = elecFlatRate;
        document.getElementById('waterFlatRate').value = waterFlatRate;
        
        document.getElementById('arrears').value = inv.arrears || 0;
        document.getElementById('otherFees').value = inv.other_fees || 0;
        document.getElementById('discount').value = inv.discount || 0;
        document.getElementById('fine').value = inv.fine || 0;
        document.getElementById('fineReason').value = inv.fine_reason || '';
        
        document.getElementById('elecFlatRate').dispatchEvent(new Event('input'));
        document.getElementById('waterFlatRate').dispatchEvent(new Event('input'));
        document.getElementById('fine').dispatchEvent(new Event('input'));
        
        recalcTotal();
        setupDueDateStatus();
        
        const modal = document.getElementById('invoiceModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeInvoiceModal() {
        const modal = document.getElementById('invoiceModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        currentEditingInvoiceId = null;
        selectedContract = null;
    }

    // ==========================================
    // 10. View Modal
    // ==========================================
    function openViewInvoiceModal(invoiceId) {
        const inv = allInvoices.find(i => Number(i.invoice_id) === Number(invoiceId));
        if (!inv) { showNotification('⚠️ ไม่พบข้อมูล', 'error'); return; }

        document.getElementById('viewInvoiceNo').innerText = `ใบแจ้งหนี้ ${inv.vol_no || '-'}`;
        document.getElementById('viewInvoiceId').innerText = `Invoice #${inv.invoice_id}`;
        document.getElementById('viewStatusBadge').innerHTML = getStatusBadge(getInvoiceStatus(inv));

        document.getElementById('viewTenantName').innerText = inv.tenant_name || '-';
        document.getElementById('viewTenantPhone').innerText = inv.tenant_phone || '-';
        document.getElementById('viewRoom').innerText = inv.room_number || '-';
        document.getElementById('viewBillingMonth').innerText = inv.billing_month || '-';

        document.getElementById('viewRoomPrice').innerText = formatNumber(inv.room_price) + ' ฿';
        document.getElementById('viewAppliance').innerText = formatNumber(inv.appliance_rental) + ' ฿';
        
        let elecLabel = '';
        if (inv.elec_flat_rate > 0) {
            elecLabel = formatNumber(inv.elec_flat_rate) + ' ฿ (เหมาจ่าย)';
        } else {
            const elecAmount = Math.max((inv.elec_curr || 0) - (inv.elec_prev || 0), 0) * (inv.elec_unit_price || 0);
            elecLabel = formatNumber(elecAmount) + ' ฿';
        }
        document.getElementById('viewElec').innerText = elecLabel;
        
        let waterLabel = '';
        if (inv.water_flat_rate > 0) {
            waterLabel = formatNumber(inv.water_flat_rate) + ' ฿ (เหมาจ่าย)';
        } else {
            const waterAmount = Math.max((inv.water_curr || 0) - (inv.water_prev || 0), 0) * (inv.water_unit_price || 0);
            waterLabel = formatNumber(waterAmount) + ' ฿';
        }
        document.getElementById('viewWater').innerText = waterLabel;
        
        document.getElementById('viewTrash').innerText = formatNumber(inv.trash_fee) + ' ฿';
        document.getElementById('viewArrears').innerText = formatNumber(inv.arrears) + ' ฿';
        document.getElementById('viewOther').innerText = formatNumber(inv.other_fees) + ' ฿';
        document.getElementById('viewDiscount').innerText = '-' + formatNumber(inv.discount) + ' ฿';
        document.getElementById('viewFine').innerText = formatNumber(inv.fine) + ' ฿';
        
        const fineReasonEl = document.getElementById('viewFineReason');
        if (inv.fine_reason && inv.fine_reason.trim() !== '') {
            fineReasonEl.innerText = inv.fine_reason;
            fineReasonEl.classList.remove('text-gray-400');
            fineReasonEl.classList.add('text-red-700', 'font-medium');
        } else if (inv.fine > 0) {
            fineReasonEl.innerText = '(ไม่ได้ระบุ)';
            fineReasonEl.classList.add('text-gray-400');
        } else {
            fineReasonEl.innerText = '- (ไม่มีค่าปรับ)';
            fineReasonEl.classList.add('text-gray-400');
        }
        
        document.getElementById('viewTotal').innerText = formatNumber(inv.total_amount) + ' ฿';
        document.getElementById('viewIssueDate').innerText = formatDateLong(inv.issue_date);
        document.getElementById('viewDueDate').innerText = formatDateLong(inv.due_date);
        document.getElementById('viewReceiptNo').innerText = inv.receipt_no || '-';

        document.getElementById('viewEditBtn').onclick = function() {
            closeViewInvoiceModal();
            setTimeout(() => openEditInvoiceModal(Number(invoiceId)), 200);
        };

        const modal = document.getElementById('viewInvoiceModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeViewInvoiceModal() {
        const modal = document.getElementById('viewInvoiceModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    // ==========================================
    // 11. บันทึก (Manual Form)
    // ==========================================
    async function saveInvoiceData(e) {
        if (e) e.preventDefault();

        const btnText = document.getElementById('saveInvoiceBtnText');
        const submitBtn = document.getElementById('saveInvoiceBtn');
        
        const contractId = document.getElementById('contractIdValue').value;
        const billingMonth = document.getElementById('billingMonth').value;
        const issueDate = document.getElementById('issueDate').value;
        const dueDate = document.getElementById('dueDate').value;
        const roomPrice = parseFloat(document.getElementById('roomPrice').value) || 0;
        const applianceRental = parseFloat(document.getElementById('applianceRental').value) || 0;
        const trashFee = parseFloat(document.getElementById('trashFee').value) || 0;
        const elecPrev = parseFloat(document.getElementById('elecPrev').value) || 0;
        const elecCurr = parseFloat(document.getElementById('elecCurr').value) || 0;
        const elecUnitPrice = parseFloat(document.getElementById('elecUnitPrice').value) || 0;
        const elecFlatRate = parseFloat(document.getElementById('elecFlatRate').value) || 0;
        const waterPrev = parseFloat(document.getElementById('waterPrev').value) || 0;
        const waterCurr = parseFloat(document.getElementById('waterCurr').value) || 0;
        const waterUnitPrice = parseFloat(document.getElementById('waterUnitPrice').value) || 0;
        const waterFlatRate = parseFloat(document.getElementById('waterFlatRate').value) || 0;
        const arrears = parseFloat(document.getElementById('arrears').value) || 0;
        const otherFees = parseFloat(document.getElementById('otherFees').value) || 0;
        const discount = parseFloat(document.getElementById('discount').value) || 0;
        const fine = parseFloat(document.getElementById('fine').value) || 0;
        const fineReason = document.getElementById('fineReason').value.trim();

        if (!contractId) return showNotification('⚠️ กรุณาเลือกสัญญา', 'error');
        if (!billingMonth) return showNotification('⚠️ กรุณาเลือกเดือนที่เรียกเก็บ', 'error');
        if (!issueDate || !dueDate) return showNotification('⚠️ กรุณาเลือกวันออกบิล/กำหนดชำระ', 'error');
        if (fine > 0 && !fineReason) return showNotification('⚠️ กรุณากรอกเหตุผลค่าปรับ', 'error');

        btnText.innerText = 'กำลังบันทึก...';
        submitBtn.disabled = true;

        try {
            const isEdit = currentEditingInvoiceId !== null;
            const endpoint = isEdit ? `${API_BASE}/invoices-update` : `${API_BASE}/invoices-create`;
            
            const payload = {
                contract_id: parseInt(contractId),
                billing_month: billingMonth,
                room_price: roomPrice,
                appliance_rental: applianceRental,
                trash_fee: trashFee,
                elec_prev: elecPrev,
                elec_curr: elecCurr,
                elec_unit_price: elecUnitPrice,
                elec_flat_rate: elecFlatRate,
                water_prev: waterPrev,
                water_curr: waterCurr,
                water_unit_price: waterUnitPrice,
                water_flat_rate: waterFlatRate,
                arrears: arrears,
                other_fees: otherFees,
                discount: discount,
                fine: fine,
                fine_reason: fine > 0 ? fineReason : null,
                issue_date: issueDate,
                due_date: dueDate
            };

            if (isEdit) payload.invoice_id = currentEditingInvoiceId;

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
                closeInvoiceModal();
                showNotification(isEdit ? '✅ แก้ไขใบแจ้งหนี้สำเร็จ!' : '✅ ออกใบแจ้งหนี้สำเร็จ!', 'success');
                setTimeout(async () => { await loadInvoices(); }, 500);
            } else {
                throw new Error(result.message || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ บันทึกล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btnText.innerText = 'บันทึก';
            submitBtn.disabled = false;
        }
    }

    // ==========================================
    // 12. Delete
    // ==========================================
    function openDeleteInvoiceModal(invoiceId, tenantName) {
        deletingInvoiceId = invoiceId;
        document.getElementById('deleteInvoiceName').innerText = tenantName || 'ไม่ระบุ';
        const modal = document.getElementById('deleteInvoiceModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeDeleteInvoiceModal() {
        const modal = document.getElementById('deleteInvoiceModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        deletingInvoiceId = null;
    }

    async function confirmDeleteInvoice() {
        if (!deletingInvoiceId) return;

        const btn = document.getElementById('confirmDeleteInvoiceBtn');
        btn.disabled = true;
        btn.innerText = 'กำลังลบ...';

        try {
            const response = await fetch(`${API_BASE}/invoices-delete?id=${deletingInvoiceId}`, { method: 'DELETE' });
            const text = await response.text();
            let raw = null;
            try { raw = text ? JSON.parse(text) : null; } catch(_) {}
            const result = extractResult(raw);

            if (response.ok && result.success === true) {
                closeDeleteInvoiceModal();
                showNotification('🗑️ ลบสำเร็จ', 'success');
                setTimeout(async () => { await loadInvoices(); }, 500);
            } else {
                throw new Error(result.message || 'ไม่สามารถลบได้');
            }
        } catch (error) {
            console.error('❌ ลบล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerText = 'ลบใบแจ้งหนี้';
        }
    }

    // ==========================================
    // 13. Billing Preview (ออกบิลรายเดือน)
    // ==========================================
    function openGenerateMonthlyModal() {
        if (!getCurrentBuildingId()) {
            showNotification('⚠️ กรุณาเลือกอาคารก่อน', 'error');
            return;
        }

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        document.getElementById('generateMonth').value = currentMonth;
        document.getElementById('generateIssueDate').value = now.toISOString().split('T')[0];
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 10);
        document.getElementById('generateDueDate').value = nextMonth.toISOString().split('T')[0];
        document.getElementById('generateElecRate').value = '0';
        document.getElementById('generateWaterRate').value = '0';
        document.getElementById('generateResult').classList.add('hidden');
        document.getElementById('billingRoomList').innerHTML = '<p class="text-center text-gray-400 py-6">กรุณากด "🔄 โหลดรายการห้อง"</p>';
        document.getElementById('billingSummary').innerText = '';

        billingPreviewData = [];
        billingSelected = new Set();

        const modal = document.getElementById('generateMonthlyModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeGenerateMonthlyModal() {
        const modal = document.getElementById('generateMonthlyModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        billingPreviewData = [];
        billingSelected = new Set();
    }

    async function loadBillingPreview() {
        const buildingId = getCurrentBuildingId();
        const billingMonth = document.getElementById('generateMonth').value;

        if (!billingMonth) {
            showNotification('⚠️ กรุณาเลือกเดือนก่อน', 'error');
            return;
        }

        const listEl = document.getElementById('billingRoomList');
        listEl.innerHTML = '<p class="text-center text-gray-400 py-6">⏳ กำลังโหลด...</p>';

        try {
            const url = `${API_BASE}/invoices-billing-preview?building_id=${buildingId}&billing_month=${billingMonth}&_t=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store' });
            const data = await res.json();

            console.log('🔍 Raw response:', data);

            let rooms = data;
            if (!Array.isArray(rooms)) {
                if (rooms && typeof rooms === 'object' && Array.isArray(rooms.data)) {
                    rooms = rooms.data;
                } else if (rooms && typeof rooms === 'object' && Object.keys(rooms).length > 0) {
                    rooms = [rooms];
                } else {
                    rooms = [];
                }
            }

            billingPreviewData = rooms;
            console.log('📦 Preview rooms:', billingPreviewData.length);

            billingSelected = new Set();
            billingPreviewData.forEach(item => {
                if (!item.has_invoice) {
                    billingSelected.add(String(item.contract_id));
                }
            });

            renderBillingList();
        } catch (err) {
            console.error('❌ Preview error:', err);
            listEl.innerHTML = `<p class="text-center text-red-500 py-6">❌ ${err.message}</p>`;
        }
    }

    // ==========================================
    // ⭐ 14. Render Billing List (v10 — แสดงเหมาจ่าย)
    // ==========================================
    function renderBillingList() {
        const listEl = document.getElementById('billingRoomList');
        
        if (billingPreviewData.length === 0) {
            listEl.innerHTML = '<p class="text-center text-gray-400 py-6">ไม่พบห้องที่มีสัญญา ACTIVE</p>';
            document.getElementById('billingSummary').innerText = '';
            return;
        }

        const grouped = {};
        billingPreviewData.forEach(item => {
            const floor = getFloor(item.room_number);
            if (!grouped[floor]) grouped[floor] = [];
            grouped[floor].push(item);
        });

        const floors = Object.keys(grouped).map(Number).sort((a, b) => a - b);

        let html = '';
        floors.forEach(floor => {
            html += `
                <div class="mb-4">
                    <div class="flex items-center justify-between bg-gray-100 px-3 py-2 rounded-lg mb-2">
                        <div class="flex items-center gap-2">
                            <input type="checkbox" class="js-floor-toggle w-4 h-4 cursor-pointer" data-floor="${floor}">
                            <span class="font-bold text-gray-800">ชั้น ${floor}</span>
                            <span class="text-xs text-gray-500">(${grouped[floor].length} ห้อง)</span>
                        </div>
                    </div>
                    <div class="space-y-2">
            `;
            
            grouped[floor].forEach(item => {
                const isBilled = item.has_invoice === true;
                const isFlatElec = String(item.elec_charge_type || '').toUpperCase() === 'FLAT_RATE';
                const isFlatWater = String(item.water_charge_type || '').toUpperCase() === 'FLAT_RATE';
                
                const elecFlatRate = parseFloat(item.elec_flat_rate) || 0;
                const waterFlatRate = parseFloat(item.water_flat_rate) || 0;
                const rentPrice = parseFloat(item.rent_price) || 0;
                
                const initialTotal = rentPrice 
                    + (isFlatElec ? elecFlatRate : 0)
                    + (isFlatWater ? waterFlatRate : 0);
                
                const disabled = isBilled ? 'opacity-50' : '';
                
                html += `
                    <div class="billing-room-item border border-gray-200 rounded-lg p-3 ${disabled}" data-contract-id="${item.contract_id}">
                        <div class="flex items-start gap-3">
                            <input type="checkbox" class="js-room-checkbox w-4 h-4 mt-1 cursor-pointer" 
                                   data-contract-id="${item.contract_id}" 
                                   ${isBilled ? 'disabled' : 'checked'}>
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-1 flex-wrap">
                                    <span class="font-bold text-blue-600">ห้อง ${escapeHtml(item.room_number)}</span>
                                    <span class="text-sm text-gray-700">${escapeHtml(item.tenant_name)}</span>
                                    ${isBilled ? '<span class="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⛔ มีบิลแล้ว</span>' : ''}
                                </div>
                                <div class="text-xs text-gray-500 mb-2">ค่าเช่า ${formatNumber(rentPrice)} ฿/เดือน</div>
                                
                                ${isBilled ? '' : `
                                <div class="grid grid-cols-2 gap-3 text-xs">
                                    ${isFlatElec ? `
                                    <div>
                                        <label class="block text-yellow-700 font-medium mb-1">⚡ เหมาจ่าย (฿)</label>
                                        <input type="number" class="w-full px-2 py-1 border-2 border-yellow-300 rounded text-sm bg-yellow-50 text-yellow-800 font-bold" 
                                               value="${elecFlatRate}" disabled>
                                    </div>
                                    ` : `
                                    <div>
                                        <label class="block text-gray-500 mb-1">⚡ ไฟ: ${item.prev_elec_meter} →</label>
                                        <input type="number" step="0.01" class="js-elec-curr w-full px-2 py-1 border border-gray-300 rounded text-sm" 
                                               value="${item.prev_elec_meter}" data-contract-id="${item.contract_id}">
                                    </div>
                                    `}
                                    ${isFlatWater ? `
                                    <div>
                                        <label class="block text-blue-700 font-medium mb-1">💧 เหมาจ่าย (฿)</label>
                                        <input type="number" class="w-full px-2 py-1 border-2 border-blue-300 rounded text-sm bg-blue-50 text-blue-800 font-bold" 
                                               value="${waterFlatRate}" disabled>
                                    </div>
                                    ` : `
                                    <div>
                                        <label class="block text-gray-500 mb-1">💧 น้ำ: ${item.prev_water_meter} →</label>
                                        <input type="number" step="0.01" class="js-water-curr w-full px-2 py-1 border border-gray-300 rounded text-sm" 
                                               value="${item.prev_water_meter}" data-contract-id="${item.contract_id}">
                                    </div>
                                    `}
                                </div>
                                <div class="text-right text-sm mt-2">
                                    <span class="text-gray-500">รวม:</span>
                                    <span class="js-room-total font-bold text-blue-700" data-contract-id="${item.contract_id}">
                                        ${formatNumber(initialTotal)} ฿
                                    </span>
                                </div>
                                `}
                            </div>
                        </div>
                    </div>
                `;
            });

            html += `</div></div>`;
        });

        listEl.innerHTML = html;

        listEl.querySelectorAll('.js-room-checkbox').forEach(cb => {
            cb.addEventListener('change', onRoomCheckChange);
        });
        listEl.querySelectorAll('.js-floor-toggle').forEach(cb => {
            cb.addEventListener('change', onFloorToggle);
        });
        listEl.querySelectorAll('.js-elec-curr, .js-water-curr').forEach(inp => {
            inp.addEventListener('input', recalcBillingRoom);
        });

        ['generateElecRate', 'generateWaterRate'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.oninput = () => { recalcAllBilling(); };
            }
        });

        updateFloorToggles();
        recalcAllBilling();
        updateBillingSummary();
    }

    function onRoomCheckChange(e) {
        const contractId = e.target.getAttribute('data-contract-id');
        if (e.target.checked) billingSelected.add(contractId);
        else billingSelected.delete(contractId);
        updateFloorToggles();
        updateBillingSummary();
    }

    function onFloorToggle(e) {
        const floor = Number(e.target.getAttribute('data-floor'));
        const checked = e.target.checked;
        
        billingPreviewData.forEach(item => {
            if (getFloor(item.room_number) === floor && !item.has_invoice) {
                const cb = document.querySelector(`.js-room-checkbox[data-contract-id="${item.contract_id}"]`);
                if (cb) {
                    cb.checked = checked;
                    if (checked) billingSelected.add(String(item.contract_id));
                    else billingSelected.delete(String(item.contract_id));
                }
            }
        });
        
        updateBillingSummary();
    }

    function updateFloorToggles() {
        const floorToggles = document.querySelectorAll('.js-floor-toggle');
        floorToggles.forEach(toggle => {
            const floor = Number(toggle.getAttribute('data-floor'));
            const floorRooms = billingPreviewData.filter(x => getFloor(x.room_number) === floor && !x.has_invoice);
            const checkedCount = floorRooms.filter(x => billingSelected.has(String(x.contract_id))).length;
            
            if (checkedCount === 0) {
                toggle.checked = false;
                toggle.indeterminate = false;
            } else if (checkedCount === floorRooms.length) {
                toggle.checked = true;
                toggle.indeterminate = false;
            } else {
                toggle.checked = false;
                toggle.indeterminate = true;
            }
        });
    }

    function recalcBillingRoom(e) {
        const contractId = e.target.getAttribute('data-contract-id');
        const item = billingPreviewData.find(x => String(x.contract_id) === String(contractId));
        if (!item) return;

        const elecRate = parseFloat(document.getElementById('generateElecRate').value) || 0;
        const waterRate = parseFloat(document.getElementById('generateWaterRate').value) || 0;

        let elecAmt = 0;
        const isFlatElec = String(item.elec_charge_type || '').toUpperCase() === 'FLAT_RATE';
        if (isFlatElec) {
            elecAmt = parseFloat(item.elec_flat_rate) || 0;
        } else {
            const elecInput = document.querySelector(`.js-elec-curr[data-contract-id="${contractId}"]`);
            const curr = parseFloat(elecInput?.value) || 0;
            elecAmt = Math.max(curr - item.prev_elec_meter, 0) * elecRate;
        }

        let waterAmt = 0;
        const isFlatWater = String(item.water_charge_type || '').toUpperCase() === 'FLAT_RATE';
        if (isFlatWater) {
            waterAmt = parseFloat(item.water_flat_rate) || 0;
        } else {
            const waterInput = document.querySelector(`.js-water-curr[data-contract-id="${contractId}"]`);
            const curr = parseFloat(waterInput?.value) || 0;
            waterAmt = Math.max(curr - item.prev_water_meter, 0) * waterRate;
        }

        const total = (parseFloat(item.rent_price) || 0) + elecAmt + waterAmt;

        const totalEl = document.querySelector(`.js-room-total[data-contract-id="${contractId}"]`);
        if (totalEl) totalEl.innerText = formatNumber(total) + ' ฿';
    }

    function recalcAllBilling() {
        document.querySelectorAll('.js-elec-curr, .js-water-curr').forEach(inp => {
            recalcBillingRoom({ target: inp });
        });
        updateBillingSummary();
    }

    function updateBillingSummary() {
        const checkedBoxes = document.querySelectorAll('.js-room-checkbox:checked:not(:disabled)');
        const count = checkedBoxes.length;
        const el = document.getElementById('billingSummary');
        
        if (count === 0) {
            el.innerText = 'ยังไม่ได้เลือกห้อง';
            return;
        }

        let totalSum = 0;
        checkedBoxes.forEach(cb => {
            const cid = cb.getAttribute('data-contract-id');
            const totalEl = document.querySelector(`.js-room-total[data-contract-id="${cid}"]`);
            if (totalEl) {
                const match = totalEl.innerText.match(/[\d,]+/);
                if (match) totalSum += parseInt(match[0].replace(/,/g, '')) || 0;
            }
        });

        el.innerText = `เลือก ${count} ห้อง • รวม ${formatNumber(totalSum)} ฿`;
    }

    async function confirmGenerateMonthly() {
        const btn = document.getElementById('generateMonthlyBtn');
        const btnText = document.getElementById('generateMonthlyBtnText');
        const resultEl = document.getElementById('generateResult');

        const billingMonth = document.getElementById('generateMonth').value;
        const issueDate = document.getElementById('generateIssueDate').value;
        const dueDate = document.getElementById('generateDueDate').value;
        const elecRate = parseFloat(document.getElementById('generateElecRate').value) || 0;
        const waterRate = parseFloat(document.getElementById('generateWaterRate').value) || 0;

        if (!billingMonth) return showNotification('⚠️ กรุณาเลือกเดือน', 'error');
        if (!issueDate || !dueDate) return showNotification('⚠️ กรุณาเลือกวันที่', 'error');

        const checkedBoxes = document.querySelectorAll('.js-room-checkbox:checked:not(:disabled)');
        if (checkedBoxes.length === 0) {
            showNotification('⚠️ กรุณาเลือกอย่างน้อย 1 ห้อง', 'error');
            return;
        }

        const rooms = [];
        checkedBoxes.forEach(cb => {
            const cid = cb.getAttribute('data-contract-id');
            const item = billingPreviewData.find(x => String(x.contract_id) === String(cid));
            if (!item) return;

            const elecInput = document.querySelector(`.js-elec-curr[data-contract-id="${cid}"]`);
            const waterInput = document.querySelector(`.js-water-curr[data-contract-id="${cid}"]`);
            
            rooms.push({
                contract_id: parseInt(cid),
                elec_curr: parseFloat(elecInput?.value) || 0,
                water_curr: parseFloat(waterInput?.value) || 0
            });
        });

        if (!confirm(`📅 ยืนยันออกบิล ${rooms.length} ห้อง?\n\nเดือน: ${billingMonth}`)) return;

        btn.disabled = true;
        btnText.innerText = 'กำลังสร้าง...';

        try {
            const processedBy = localStorage.getItem('admin_username') || 'admin';

            const payload = {
                p_billing_month: billingMonth,
                p_issue_date: issueDate,
                p_due_date: dueDate,
                p_elec_rate: elecRate,
                p_water_rate: waterRate,
                p_rooms: rooms,
                p_created_by: processedBy
            };

            const res = await fetch(`${API_BASE}/invoices-generate-monthly`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const text = await res.text();
            const raw = text ? JSON.parse(text) : null;
            const result = extractResult(raw);

            if (res.ok && result.success === true) {
                const data = result.data || {};
                resultEl.className = 'bg-green-50 border border-green-200 rounded-lg p-3 text-sm mt-3';
                resultEl.innerHTML = `
                    <p class="font-bold text-green-800 mb-1">✅ สร้างบิลสำเร็จ!</p>
                    <p class="text-xs text-green-700">สร้างใหม่: <strong>${data.created_count || 0}</strong> รายการ</p>
                    <p class="text-xs text-green-700">ข้าม: <strong>${data.skipped_count || 0}</strong> รายการ</p>
                `;
                resultEl.classList.remove('hidden');

                showNotification(`✅ สร้างบิล ${data.created_count || 0} รายการ`, 'success');

                setTimeout(() => {
                    closeGenerateMonthlyModal();
                    const mf = document.getElementById('monthFilter');
                    if (mf) mf.value = billingMonth;
                    loadInvoices();
                }, 2000);
            } else {
                throw new Error(result.message || `HTTP ${res.status}`);
            }
        } catch (err) {
            console.error('❌ generate failed:', err);
            resultEl.className = 'bg-red-50 border border-red-200 rounded-lg p-3 text-sm mt-3';
            resultEl.innerHTML = `<p class="text-red-700">❌ ${err.message}</p>`;
            resultEl.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btnText.innerText = '✅ ยืนยันออกบิล';
        }
    }

    // ==========================================
    // 15. Filters
    // ==========================================
    function setupFilters() {
        const statusFilter = document.getElementById('statusFilter');
        const monthFilter = document.getElementById('monthFilter');
        const search = document.getElementById('searchInvoice');
        
        if (statusFilter) statusFilter.addEventListener('change', renderInvoices);
        if (monthFilter) monthFilter.addEventListener('change', renderInvoices);
        if (search) {
            search.addEventListener('input', () => {
                clearTimeout(window._invoiceSearchTimer);
                window._invoiceSearchTimer = setTimeout(renderInvoices, 200);
            });
        }
    }

    // ==========================================
    // 16. Export
    // ==========================================
    window.openAddInvoiceModal = openAddInvoiceModal;
    window.openEditInvoiceModal = openEditInvoiceModal;
    window.closeInvoiceModal = closeInvoiceModal;
    window.openViewInvoiceModal = openViewInvoiceModal;
    window.closeViewInvoiceModal = closeViewInvoiceModal;
    window.openDeleteInvoiceModal = openDeleteInvoiceModal;
    window.closeDeleteInvoiceModal = closeDeleteInvoiceModal;
    window.loadInvoices = loadInvoices;
    window.openGenerateMonthlyModal = openGenerateMonthlyModal;
    window.closeGenerateMonthlyModal = closeGenerateMonthlyModal;
    window.loadBillingPreview = loadBillingPreview;
    window.confirmGenerateMonthly = confirmGenerateMonthly;

    // ==========================================
    // 17. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 invoices.js v10 เริ่มทำงาน');
        setTimeout(() => { loadInvoices(); }, 300);

        const form = document.getElementById('invoiceForm');
        if (form) form.addEventListener('submit', saveInvoiceData);

        const confirmBtn = document.getElementById('confirmDeleteInvoiceBtn');
        if (confirmBtn) confirmBtn.addEventListener('click', confirmDeleteInvoice);

        setupFilters();
        setupContractSearch();
        setupTotalCalculation();
        setupDueDateStatus();
        setupFineReason();
        setupMeterOverride();

        window.addEventListener('buildingChanged', () => loadInvoices());
        
        lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const currentId = getCurrentBuildingId();
            if (currentId !== lastBuildingId) {
                lastBuildingId = currentId;
                loadInvoices();
            }
        }, 1000);

        console.log('✅ invoices.js v10 โหลดสำเร็จ');
    });

})();
