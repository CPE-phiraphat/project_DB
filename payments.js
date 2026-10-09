/* ==========================================
 * payments.js - ตรวจสอบการชำระเงิน (v5)
 * ⭐ เปลี่ยนการลบสลิปให้ผ่าน n8n แทน Supabase โดยตรง
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'http://n8n_mirot.minmark.xyz/webhook';

    let allPayments = [];
    let currentInvoiceId = null;
    let deletingPaymentId = null;
    let lastBuildingId = '';
    let isLoading = false;

    const showNotification = window.showNotification;
    const escapeHtml = window.escapeHtml;
    const formatNumber = window.formatNumber;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

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

    function getPaymentStatus(inv) {
        if (inv.is_paid) return 'paid';
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

    // ==========================================
    // ⭐ 0. Helper: ลบไฟล์สลิปผ่าน n8n (ปลอดภัย)
    // ==========================================
    async function deleteSlipViaN8N(slipUrl) {
        if (!slipUrl) return false;
        
        try {
            const response = await fetch(`${API_BASE}/delete-slip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slip_url: slipUrl })
            });
            
            const text = await response.text();
            const raw = text ? JSON.parse(text) : null;
            const result = extractResult(raw);
            
            if (response.ok && result.success === true) {
                console.log('🗑️ ลบรูปผ่าน n8n สำเร็จ:', slipUrl);
                return true;
            }
            console.warn('⚠️ ลบรูปไม่สำเร็จ:', result.message);
            return false;
        } catch (err) {
            console.warn('⚠️ ลบรูปผ่าน n8n error:', err);
            return false;
        }
    }

    // ==========================================
    // 1. โหลด
    // ==========================================
    async function loadPayments() {
        const tbody = document.getElementById('paymentTableBody');
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

            const url = `${API_BASE}/payments?building_id=${buildingId}&_t=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : [];
            let payments = toArray(parsed);
            
            allPayments = payments.filter(p => p.is_deleted !== true && p.is_deleted !== 'true');
            
            console.log(`📦 โหลด ${allPayments.length} รายการ`);
            renderPayments();
            
            const subtitle = document.getElementById('paymentSubtitle');
            if (subtitle) subtitle.innerText = `รายการใน ${getCurrentBuildingName() || 'อาคารปัจจุบัน'}`;
        } catch (error) {
            console.error('❌ โหลดล้มเหลว:', error);
            tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-red-500">⚠️ ${escapeHtml(error.message)}</td></tr>`;
        } finally {
            isLoading = false;
        }
    }

    // ==========================================
    // 2. Render
    // ==========================================
    function renderPayments() {
        const tbody = document.getElementById('paymentTableBody');
        if (!tbody) return;

        const statusFilter = document.getElementById('statusFilter')?.value || '';
        const searchQuery = (document.getElementById('searchPayment')?.value || '').trim().toLowerCase();

        let filtered = allPayments.filter(inv => {
            const status = getPaymentStatus(inv);
            if (statusFilter && status !== statusFilter) return false;
            if (searchQuery) {
                const name = String(inv.tenant_name || '').toLowerCase();
                const room = String(inv.room_number || '').toLowerCase();
                const volNo = String(inv.vol_no || '').toLowerCase();
                if (!name.includes(searchQuery) && !room.includes(searchQuery) && !volNo.includes(searchQuery)) return false;
            }
            return true;
        });

        filtered.sort((a, b) => (b.invoice_id || 0) - (a.invoice_id || 0));

        const countEl = document.getElementById('paymentCount');
        if (countEl) countEl.innerText = filtered.length;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">
                ${allPayments.length === 0 ? 'ยังไม่มีรายการในอาคารนี้' : 'ไม่พบรายการที่ตรงกับเงื่อนไข'}
            </td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(inv => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition';

            const status = getPaymentStatus(inv);
            const statusBadge = getStatusBadge(status);

            let dueDateHtml = '-';
            if (inv.paid_date) {
                const d = new Date(inv.paid_date);
                dueDateHtml = formatDate(inv.paid_date);
                if (inv.paid_amount && inv.total_amount && inv.paid_amount < inv.total_amount) {
                    dueDateHtml += `<span class="block text-xs text-orange-600 font-medium mt-1">(บางส่วน)</span>`;
                }
            } else if (status === 'overdue') {
                const days = Math.abs(daysBetween(new Date(), inv.due_date));
                dueDateHtml = `<span class="text-xs text-red-600 font-medium">เลย ${days} วัน</span>`;
            }

            let actionButtons = '';
            if (status === 'paid') {
                actionButtons = `
                    <button data-view-id="${inv.invoice_id}" class="js-view-payment bg-green-100 hover:bg-green-200 text-green-700 px-2 py-1.5 rounded-md text-xs font-medium transition mr-1" title="ดูสลิป">👁️</button>
                    <button data-toggle-id="${inv.invoice_id}" class="js-toggle-paid bg-yellow-100 hover:bg-yellow-200 text-yellow-700 px-2 py-1.5 rounded-md text-xs font-medium transition mr-1" title="ยกเลิกการชำระ">🔄</button>
                    <button data-delete-bill="${inv.invoice_id}" class="js-delete-bill bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1.5 rounded-md text-xs font-medium transition" title="ลบบิล">🗑️</button>
                `;
            } else {
                actionButtons = `
                    <button data-record-id="${inv.invoice_id}" class="js-record-payment bg-green-600 hover:bg-green-700 text-white px-2.5 py-1.5 rounded-md text-xs font-medium transition mr-1">✅ รับชำระ</button>
                    <button data-toggle-id="${inv.invoice_id}" class="js-toggle-paid bg-yellow-100 hover:bg-yellow-200 text-yellow-700 px-2 py-1.5 rounded-md text-xs font-medium transition mr-1" title="Mark ชำระแล้ว (ไม่มีสลิป)">🔄</button>
                    <button data-delete-bill="${inv.invoice_id}" class="js-delete-bill bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1.5 rounded-md text-xs font-medium transition" title="ลบบิล">🗑️</button>
                `;
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
                <td class="px-4 py-3 text-right whitespace-nowrap">${actionButtons}</td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.js-record-payment').forEach(btn => {
            btn.addEventListener('click', function() {
                openPaymentModal(parseInt(this.getAttribute('data-record-id')));
            });
        });
        tbody.querySelectorAll('.js-view-payment').forEach(btn => {
            btn.addEventListener('click', function() {
                openViewPaymentModal(parseInt(this.getAttribute('data-view-id')));
            });
        });
        tbody.querySelectorAll('.js-toggle-paid').forEach(btn => {
            btn.addEventListener('click', function() {
                toggleInvoicePaid(parseInt(this.getAttribute('data-toggle-id')));
            });
        });
        tbody.querySelectorAll('.js-delete-bill').forEach(btn => {
            btn.addEventListener('click', function() {
                deleteInvoiceFull(parseInt(this.getAttribute('data-delete-bill')));
            });
        });
    }

    // ==========================================
    // 3. Modal: Record Payment
    // ==========================================
    function openPaymentModal(invoiceId) {
        const inv = allPayments.find(x => Number(x.invoice_id) === Number(invoiceId));
        if (!inv) { showNotification('⚠️ ไม่พบข้อมูล', 'error'); return; }

        currentInvoiceId = Number(invoiceId);

        document.getElementById('paymentModalTitle').innerText = 'บันทึกการชำระเงิน';
        document.getElementById('paymentForm').reset();
        document.getElementById('paymentInvoiceId').value = inv.invoice_id;
        
        document.getElementById('infoRoom').innerText = inv.room_number || '-';
        document.getElementById('infoTenant').innerText = inv.tenant_name || '-';
        document.getElementById('infoBillingMonth').innerText = inv.billing_month || '-';
        document.getElementById('infoTotal').innerText = formatNumber(inv.total_amount) + ' ฿';
        
        document.getElementById('paidAmount').value = inv.total_amount || 0;
        
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('paidDate').value = today;
        
        document.getElementById('paymentMethod').value = 'transfer';
        
        resetSlipUpload();
        
        const modal = document.getElementById('paymentModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closePaymentModal() {
        const modal = document.getElementById('paymentModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        currentInvoiceId = null;
        resetSlipUpload();
    }

    // ==========================================
    // 4. บันทึกชำระ
    // ==========================================
    async function savePayment(e) {
        if (e) e.preventDefault();

        const btnText = document.getElementById('savePaymentBtnText');
        const submitBtn = document.getElementById('savePaymentBtn');
        
        const invoiceId = document.getElementById('paymentInvoiceId').value;
        const amount = parseFloat(document.getElementById('paidAmount').value) || 0;
        const paidDate = document.getElementById('paidDate').value;
        const method = document.getElementById('paymentMethod').value;
        const slipUrl = document.getElementById('slipUrl').value.trim();
        const note = document.getElementById('paymentNote').value.trim();

        if (!invoiceId) return showNotification('⚠️ ไม่พบรหัสบิล', 'error');
        if (!amount || amount <= 0) return showNotification('⚠️ กรุณากรอกจำนวนเงิน', 'error');
        if (!paidDate) return showNotification('⚠️ กรุณาเลือกวันที่ชำระ', 'error');

        btnText.innerText = 'กำลังบันทึก...';
        submitBtn.disabled = true;

        try {
            const payload = {
                invoice_id: parseInt(invoiceId),
                amount: amount,
                paid_date: paidDate,
                method: method,
                slip_image_url: slipUrl || null,
                note: note || null
            };

            console.log('📤 ส่งข้อมูล:', payload);

            const response = await fetch(`${API_BASE}/payments-create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const text = await response.text();
            console.log('📥 Response:', response.status, text);
            
            let raw = null;
            try { raw = text ? JSON.parse(text) : null; } catch(_) {}
            const result = extractResult(raw);

            if (response.ok && result.success === true) {
                closePaymentModal();
                showNotification('✅ บันทึกการชำระสำเร็จ!', 'success');
                setTimeout(async () => { await loadPayments(); }, 500);
            } else {
                throw new Error(result.message || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ บันทึกล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        } finally {
            btnText.innerText = '✅ ยืนยันการชำระ';
            submitBtn.disabled = false;
        }
    }

    // ==========================================
    // 5. View Modal
    // ==========================================
    function openViewPaymentModal(invoiceId) {
        const inv = allPayments.find(x => Number(x.invoice_id) === Number(invoiceId));
        if (!inv) { showNotification('⚠️ ไม่พบข้อมูล', 'error'); return; }

        document.getElementById('viewPaymentNo').innerText = `การชำระเงิน ${inv.vol_no || '-'}`;
        document.getElementById('viewPaymentId').innerText = `Payment #${inv.payment_id || '-'}`;
        document.getElementById('viewStatusBadge').innerHTML = getStatusBadge(getPaymentStatus(inv));

        document.getElementById('viewTenantName').innerText = inv.tenant_name || '-';
        document.getElementById('viewTenantPhone').innerText = inv.tenant_phone || '-';
        document.getElementById('viewRoom').innerText = inv.room_number || '-';
        document.getElementById('viewBillingMonth').innerText = inv.billing_month || '-';

        document.getElementById('viewTotalAmount').innerText = formatNumber(inv.total_amount) + ' ฿';
        document.getElementById('viewPaidAmount').innerText = formatNumber(inv.paid_amount) + ' ฿';

        document.getElementById('viewPaidDate').innerText = formatDateLong(inv.paid_date);
        const methodLabels = { transfer: '🏦 โอนเงิน', cash: '💵 เงินสด', promptpay: '📱 พร้อมเพย์', other: '📌 อื่นๆ' };
        document.getElementById('viewMethod').innerText = methodLabels[inv.method] || inv.method || '-';
        document.getElementById('viewReceiptNo').innerText = inv.receipt_no || '-';

        const noteWrap = document.getElementById('viewNoteWrap');
        if (inv.note) {
            document.getElementById('viewNote').innerText = inv.note;
            noteWrap.classList.remove('hidden');
        } else {
            noteWrap.classList.add('hidden');
        }

        const slipWrap = document.getElementById('viewSlipWrap');
        if (inv.slip_image_url) {
            document.getElementById('viewSlipImage').src = inv.slip_image_url;
            document.getElementById('viewSlipLink').href = inv.slip_image_url;
            slipWrap.classList.remove('hidden');
        } else {
            slipWrap.classList.add('hidden');
        }

        document.getElementById('viewDeleteBtn').onclick = function() {
            if (confirm('⚠️ ต้องการลบรายการชำระนี้?')) {
                closeViewPaymentModal();
                deletePayment(inv.payment_id);
            }
        };

        const modal = document.getElementById('viewPaymentModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeViewPaymentModal() {
        const modal = document.getElementById('viewPaymentModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    // ==========================================
    // 6. Delete Payment (กลับเป็น unpaid)
    // ==========================================
    async function deletePayment(paymentId) {
        if (!paymentId) return;

        const inv = allPayments.find(x => Number(x.payment_id) === Number(paymentId));
        
        try {
            const response = await fetch(`${API_BASE}/payments-delete?id=${paymentId}`, { method: 'DELETE' });
            const text = await response.text();
            let raw = null;
            try { raw = text ? JSON.parse(text) : null; } catch(_) {}
            const result = extractResult(raw);

            if (response.ok && result.success === true) {
                // ⭐ ลบรูปผ่าน n8n
                if (inv && inv.slip_image_url) {
                    await deleteSlipViaN8N(inv.slip_image_url);
                }
                showNotification('🗑️ ลบสำเร็จ — บิลกลับเป็น "ยังไม่ชำระ"', 'success');
                setTimeout(async () => { await loadPayments(); }, 500);
            } else {
                throw new Error(result.message || 'ไม่สามารถลบได้');
            }
        } catch (error) {
            console.error('❌ ลบล้มเหลว:', error);
            showNotification('❌ ' + error.message, 'error');
        }
    }

    // ==========================================
    // 7. Toggle Invoice Paid (+ ลบรูปถ้ายกเลิก)
    // ==========================================
    async function toggleInvoicePaid(invoiceId) {
        const inv = allPayments.find(x => Number(x.invoice_id) === Number(invoiceId));
        if (!inv) return;
        
        const isPaidNow = inv.is_paid;
        const confirmMsg = isPaidNow 
            ? '⚠️ ต้องการยกเลิกการชำระบิลนี้?\n\nสถานะจะกลับเป็น "รอรับชำระ"\nและรูปสลิปจะถูกลบออกจาก Storage'
            : '✅ ต้องการทำเครื่องหมายว่า "ชำระแล้ว" หรือไม่?\n\n(ใช้กรณีชำระเงินสด ไม่มีสลิป)';
        
        if (!confirm(confirmMsg)) return;
        
        try {
            const response = await fetch(`${API_BASE}/invoices-toggle-paid`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ invoice_id: invoiceId, receipt_no: null })
            });
            const text = await response.text();
            const raw = text ? JSON.parse(text) : null;
            const result = extractResult(raw);
            
            if (response.ok && result.success === true) {
                // ⭐ ถ้ายกเลิกการชำระ ให้ลบรูปผ่าน n8n
                if (isPaidNow && inv.slip_image_url) {
                    await deleteSlipViaN8N(inv.slip_image_url);
                }
                showNotification(
                    isPaidNow ? '🔄 ยกเลิกการชำระสำเร็จ' : '✅ ทำเครื่องหมายชำระแล้ว', 
                    'success'
                );
                setTimeout(async () => { await loadPayments(); }, 500);
            } else {
                throw new Error(result.message || 'ไม่สำเร็จ');
            }
        } catch (error) {
            console.error('❌ toggle failed:', error);
            showNotification('❌ ' + error.message, 'error');
        }
    }

    // ==========================================
    // 8. Delete Invoice (Full) (+ ลบรูป)
    // ==========================================
    async function deleteInvoiceFull(invoiceId) {
        const inv = allPayments.find(x => Number(x.invoice_id) === Number(invoiceId));
        
        if (!confirm('⚠️ ต้องการลบบิลนี้?\n\nบิลจะหายไปจากระบบ และรูปสลิปจะถูกลบออกจาก Storage')) return;
        
        try {
            const response = await fetch(`${API_BASE}/invoices-delete-full`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ invoice_id: invoiceId })
            });
            const text = await response.text();
            const raw = text ? JSON.parse(text) : null;
            const result = extractResult(raw);
            
            if (response.ok && result.success === true) {
                // ⭐ ลบรูปผ่าน n8n
                if (inv && inv.slip_image_url) {
                    await deleteSlipViaN8N(inv.slip_image_url);
                }
                showNotification('🗑️ ลบบิลสำเร็จ', 'success');
                setTimeout(async () => { await loadPayments(); }, 500);
            } else {
                throw new Error(result.message || 'ไม่สำเร็จ');
            }
        } catch (error) {
            console.error('❌ delete failed:', error);
            showNotification('❌ ' + error.message, 'error');
        }
    }

    // ==========================================
    // 9. Filters
    // ==========================================
    function setupFilters() {
        const statusFilter = document.getElementById('statusFilter');
        const search = document.getElementById('searchPayment');
        
        if (statusFilter) statusFilter.addEventListener('change', renderPayments);
        if (search) {
            search.addEventListener('input', () => {
                clearTimeout(window._paymentSearchTimer);
                window._paymentSearchTimer = setTimeout(renderPayments, 200);
            });
        }
    }

    // ==========================================
    // 10. Upload Slip (ยังใช้ Supabase โดยตรงเหมือนเดิม)
    // ==========================================
    async function uploadSlipToSupabase(file) {
        const config = window.SUPABASE_CONFIG;
        if (!config || !config.url || !config.anonKey) {
            throw new Error('ไม่พบการตั้งค่า Supabase');
        }
        
        if (file.size > 5 * 1024 * 1024) {
            throw new Error('ไฟล์ใหญ่เกิน 5 MB');
        }
        
        if (!file.type.startsWith('image/')) {
            throw new Error('ต้องเป็นไฟล์รูปภาพเท่านั้น');
        }
        
        const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
        const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
        
        console.log('📤 Uploading:', filename, '| Size:', (file.size / 1024).toFixed(0) + ' KB');
        
        const response = await fetch(
            `${config.url}/storage/v1/object/slips/${filename}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.anonKey}`,
                    'apikey': config.anonKey,
                    'x-upsert': 'true'
                },
                body: file
            }
        );
        
        if (!response.ok) {
            const errText = await response.text();
            console.error('❌ Upload error:', errText);
            throw new Error('อัปโหลดรูปไม่สำเร็จ');
        }
        
        const publicUrl = `${config.url}/storage/v1/object/public/slips/${filename}`;
        console.log('✅ Uploaded:', publicUrl);
        return publicUrl;
    }

    // ==========================================
    // 11. Setup Slip Upload
    // ==========================================
    function setupSlipUpload() {
        const fileInput = document.getElementById('slipFile');
        const uploadArea = document.getElementById('slipUploadArea');
        const placeholder = document.getElementById('slipPlaceholder');
        const previewWrap = document.getElementById('slipPreviewWrap');
        const preview = document.getElementById('slipPreview');
        const statusEl = document.getElementById('slipUploadStatus');
        const slipUrlInput = document.getElementById('slipUrl');
        
        if (!fileInput || !uploadArea) return;
        
        uploadArea.addEventListener('click', () => fileInput.click());
        
        fileInput.addEventListener('change', async function() {
            const file = this.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                preview.src = e.target.result;
                placeholder.classList.add('hidden');
                previewWrap.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
            
            statusEl.className = 'mt-2 text-xs text-blue-600 flex items-center gap-2';
            statusEl.innerHTML = '<span class="animate-spin inline-block">🔄</span> กำลังอัปโหลด...';
            statusEl.classList.remove('hidden');
            
            try {
                const url = await uploadSlipToSupabase(file);
                slipUrlInput.value = url;
                statusEl.className = 'mt-2 text-xs text-green-600 font-medium';
                statusEl.innerHTML = '✅ อัปโหลดสำเร็จ! พร้อมบันทึก';
            } catch (error) {
                console.error('❌ Upload failed:', error);
                statusEl.className = 'mt-2 text-xs text-red-600 font-medium';
                statusEl.innerHTML = '❌ ' + error.message;
                slipUrlInput.value = '';
                preview.src = '';
                placeholder.classList.remove('hidden');
                previewWrap.classList.add('hidden');
            }
        });
    }

    // ==========================================
    // 12. Reset Slip UI
    // ==========================================
    function resetSlipUpload() {
        const fileInput = document.getElementById('slipFile');
        const placeholder = document.getElementById('slipPlaceholder');
        const previewWrap = document.getElementById('slipPreviewWrap');
        const preview = document.getElementById('slipPreview');
        const statusEl = document.getElementById('slipUploadStatus');
        const slipUrlInput = document.getElementById('slipUrl');
        
        if (fileInput) fileInput.value = '';
        if (preview) preview.src = '';
        if (placeholder) placeholder.classList.remove('hidden');
        if (previewWrap) previewWrap.classList.add('hidden');
        if (statusEl) statusEl.classList.add('hidden');
        if (slipUrlInput) slipUrlInput.value = '';
    }

    // ==========================================
    // 13. Export
    // ==========================================
    window.openPaymentModal = openPaymentModal;
    window.closePaymentModal = closePaymentModal;
    window.openViewPaymentModal = openViewPaymentModal;
    window.closeViewPaymentModal = closeViewPaymentModal;
    window.loadPayments = loadPayments;
    window.deleteSlipViaN8N = deleteSlipViaN8N;

    // ==========================================
    // 14. Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 payments.js v5 เริ่มทำงาน');
        setTimeout(() => { loadPayments(); }, 300);

        const form = document.getElementById('paymentForm');
        if (form) form.addEventListener('submit', savePayment);

        setupFilters();
        setupSlipUpload();
        resetSlipUpload();

        window.addEventListener('buildingChanged', () => loadPayments());
        
        lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const currentId = getCurrentBuildingId();
            if (currentId !== lastBuildingId) {
                lastBuildingId = currentId;
                loadPayments();
            }
        }, 1000);

        console.log('✅ payments.js v5 โหลดสำเร็จ');
    });

})();
