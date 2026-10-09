/* ==========================================
 * reports.js - รายงาน & Export PDF/Excel (v3)
 * ⭐ v3: วันที่ไทย + แถวสรุปยอด + สีหัวตาราง
 * ========================================== */
(function() {
    'use strict';

    const API_BASE = 'https://localhost:5678/webhook';

    let lastBuildingId = '';

    const showNotification = window.showNotification;
    const formatNumber = window.formatNumber;
    const toArray = window.toArray;
    const getCurrentBuildingId = window.getCurrentBuildingId;
    const getCurrentBuildingName = window.getCurrentBuildingName;

    // ==========================================
    // Helpers
    // ==========================================
    function normalizeStatus(s) {
        return String(s || '').trim().toUpperCase();
    }

    function isDeleted(obj) {
        if (!obj) return true;
        const v = obj.is_deleted;
        return v === true || v === 'true';
    }

    function isPaid(obj) {
        const v = obj.is_paid || obj.paid;
        return v === true || v === 'true' || v === 1 || v === '1';
    }

    function formatDate(d) {
        if (!d) return '-';
        try {
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return d;
            return dt.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch { return d; }
    }

    function formatDateLong(d) {
        if (!d) return '-';
        try {
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return d;
            return dt.toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' });
        } catch { return d; }
    }

    // ⭐ วันที่แบบไทย dd/mm/yyyy สำหรับ Excel
    function formatDateThai(d) {
        if (!d) return '';
        try {
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return String(d);
            const day = String(dt.getDate()).padStart(2, '0');
            const month = String(dt.getMonth() + 1).padStart(2, '0');
            const year = dt.getFullYear();
            return `${day}/${month}/${year}`;
        } catch { return String(d); }
    }

    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        return text ? JSON.parse(text) : [];
    }

    function showLoading(text) {
        document.getElementById('loadingText').innerText = text || 'กรุณารอสักครู่';
        const el = document.getElementById('loadingOverlay');
        el.classList.remove('hidden');
        el.classList.add('flex');
    }

    function hideLoading() {
        const el = document.getElementById('loadingOverlay');
        el.classList.add('hidden');
        el.classList.remove('flex');
    }

    // ==========================================
    // PDF Generator
    // ==========================================
    function generatePDF(title, subtitle, columns, rows) {
        const win = window.open('', '_blank');
        if (!win) {
            showNotification('⚠️ เบราว์เซอร์บล็อก popup — กรุณาอนุญาต', 'error');
            return;
        }

        const buildingName = getCurrentBuildingName() || 'อาคารปัจจุบัน';
        const now = new Date().toLocaleString('th-TH');

        const tableHead = columns.map(c => `<th>${c.label}</th>`).join('');
        const tableBody = rows.map(row => {
            const cells = columns.map(c => {
                let val = row[c.key];
                if (c.format === 'number') val = formatNumber(val);
                else if (c.format === 'date') val = formatDate(val);
                else if (c.format === 'money') val = formatNumber(val);
                return `<td>${val ?? '-'}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');

        const html = `
            <!DOCTYPE html>
            <html lang="th">
            <head>
                <meta charset="UTF-8">
                <title>${title}</title>
                <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
                <style>
                    @page { size: A4 landscape; margin: 15mm; }
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: 'Sarabun', sans-serif; padding: 20px; color: #333; }
                    .header { text-align: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 3px solid #1e40af; }
                    .header h1 { font-size: 22px; color: #1e40af; margin-bottom: 5px; }
                    .header .subtitle { font-size: 13px; color: #666; }
                    .header .meta { font-size: 11px; color: #888; margin-top: 8px; }
                    table { width: 100%; border-collapse: collapse; font-size: 12px; }
                    thead { background: #1e40af; color: white; }
                    th { padding: 10px 8px; text-align: left; font-weight: 600; font-size: 11px; }
                    td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
                    tbody tr:nth-child(even) { background: #f9fafb; }
                    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #888; text-align: center; }
                    @media print { body { padding: 0; } }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>${title}</h1>
                    <div class="subtitle">${subtitle || ''}</div>
                    <div class="meta">${buildingName} • พิมพ์เมื่อ: ${now}</div>
                </div>
                <table>
                    <thead><tr>${tableHead}</tr></thead>
                    <tbody>${tableBody}</tbody>
                </table>
                <div class="footer">ทั้งหมด ${rows.length} รายการ • ระบบจัดการหอพัก ศิรินทร์ พลัส</div>
                <script>
                    window.onload = function() { setTimeout(() => window.print(), 500); };
                <\/script>
            </body>
            </html>
        `;

        win.document.write(html);
        win.document.close();
    }

    // ==========================================
    // ⭐ Excel Generator (v3 — สวย + สรุป)
    // ==========================================
    function generateExcel(filename, sheetName, columns, rows) {
        // ⭐ แปลงค่า
        const headerRow = columns.map(c => c.label);
        const bodyRows = rows.map(row => columns.map(c => {
            let val = row[c.key];
            if (c.format === 'number' || c.format === 'money') {
                return Number(val) || 0;
            }
            if (c.format === 'date_th') {
                return formatDateThai(val);  // ⭐ วันที่ไทย dd/mm/yyyy
            }
            return val ?? '';
        }));

        // ⭐ หา index ของคอลัมน์ money/number สำหรับ summary
        const moneyColIdx = columns.findIndex(c => c.format === 'money' || c.format === 'number');

        // ⭐ สร้างแถวสรุปยอด (ถ้ามี)
        const data = [headerRow, ...bodyRows];

        if (moneyColIdx >= 0 && bodyRows.length > 0) {
            const totalRow = new Array(columns.length).fill('');
            totalRow[0] = 'รวมทั้งสิ้น';
            totalRow[moneyColIdx] = bodyRows.reduce((sum, row) => {
                return sum + (Number(row[moneyColIdx]) || 0);
            }, 0);
            data.push(totalRow);
        }

        const ws = XLSX.utils.aoa_to_sheet(data);

        // ⭐ สีหัวตาราง (น้ำเงินเข้ม) + ตัวอักษรขาว
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let C = range.s.c; C <= range.e.c; C++) {
            const cell = XLSX.utils.encode_cell({ r: 0, c: C });
            if (!ws[cell]) continue;
            ws[cell].s = {
                fill: { fgColor: { rgb: "1E40AF" } },
                font: { color: { rgb: "FFFFFF" }, bold: true, sz: 12 },
                alignment: { horizontal: 'center', vertical: 'center' }
            };
        }

        // ⭐ แถวสรุป: พื้นหลังเหลือง + ตัวหนา
        if (moneyColIdx >= 0 && bodyRows.length > 0) {
            const lastRowIdx = data.length - 1;
            for (let C = range.s.c; C <= range.e.c; C++) {
                const cell = XLSX.utils.encode_cell({ r: lastRowIdx, c: C });
                if (!ws[cell]) {
                    ws[cell] = { t: 's', v: '' };
                }
                ws[cell].s = {
                    fill: { fgColor: { rgb: "FEF3C7" } },
                    font: { bold: true, sz: 12, color: { rgb: "92400E" } }
                };
            }
        }

        // ⭐ จัดคอลัมน์ + ความกว้าง
        const colWidths = columns.map((c, i) => {
            let maxLen = c.label.length;
            bodyRows.forEach(row => {
                const val = String(row[i] ?? '');
                if (val.length > maxLen) maxLen = val.length;
            });
            return { wch: Math.min(maxLen + 4, 40) };
        });
        ws['!cols'] = colWidths;

        // ⭐ จัดตัวเลข (คอลัมน์ money) → ขวา
        if (moneyColIdx >= 0) {
            for (let R = 1; R <= bodyRows.length; R++) {
                const cell = XLSX.utils.encode_cell({ r: R, c: moneyColIdx });
                if (ws[cell]) {
                    ws[cell].s = ws[cell].s || {};
                    ws[cell].s.alignment = { horizontal: 'right' };
                    ws[cell].z = '#,##0';
                }
            }
        }

        // ⭐ Freeze header
        ws['!freeze'] = { xSplit: 0, ySplit: 1 };

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');

        XLSX.writeFile(wb, `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`);
    }

    // ==========================================
    // Report 1: รายงานรายรับ
    // ==========================================
    async function exportIncomeReport(type) {
        const buildingId = getCurrentBuildingId();
        if (!buildingId) return showNotification('⚠️ กรุณาเลือกอาคาร', 'error');

        showLoading('กำลังโหลดรายรับ...');
        try {
            const url = `${API_BASE}/payments?building_id=${buildingId}&_t=${Date.now()}`;
            const raw = await fetchJson(url);
            const payments = toArray(raw).filter(p => !isDeleted(p) && isPaid(p));

            const startMonth = document.getElementById('startMonth').value;
            const endMonth = document.getElementById('endMonth').value;

            let filtered = payments;
            if (startMonth) filtered = filtered.filter(p => (p.billing_month || '') >= startMonth);
            if (endMonth) filtered = filtered.filter(p => (p.billing_month || '') <= endMonth);

            filtered.sort((a, b) => String(a.billing_month || '').localeCompare(String(b.billing_month || '')));

            const columns = [
                { key: 'vol_no', label: 'เลขที่บิล' },
                { key: 'billing_month', label: 'เดือน' },
                { key: 'room_number', label: 'ห้อง' },
                { key: 'tenant_name', label: 'ผู้เช่า' },
                { key: 'paid_date', label: 'วันที่ชำระ', format: 'date_th' },
                { key: 'paid_amount', label: 'ยอดชำระ (฿)', format: 'money' },
                { key: 'method', label: 'วิธี' },
                { key: 'receipt_no', label: 'เลขใบเสร็จ' }
            ];

            const total = filtered.reduce((sum, p) => sum + (parseFloat(p.paid_amount) || 0), 0);
            const subtitle = `ยอดรวม: ${formatNumber(total)} ฿ (${filtered.length} รายการ)`;

            if (type === 'excel') {
                generateExcel('รายงานรายรับ', 'รายรับ', columns, filtered);
                showNotification('✅ สร้าง Excel สำเร็จ', 'success');
            } else {
                generatePDF('รายงานรายรับ', subtitle, columns, filtered);
            }
        } catch (err) {
            console.error('❌', err);
            showNotification('❌ ' + err.message, 'error');
        } finally {
            hideLoading();
        }
    }

    // ==========================================
    // Report 2: ทะเบียนผู้เช่า
    // ==========================================
    async function exportTenantReport(type) {
        const buildingId = getCurrentBuildingId();
        if (!buildingId) return showNotification('⚠️ กรุณาเลือกอาคาร', 'error');

        showLoading('กำลังโหลดผู้เช่า...');
        try {
            const url = `${API_BASE}/tenants?building_id=${buildingId}&_t=${Date.now()}`;
            const raw = await fetchJson(url);
            const tenants = toArray(raw).filter(t => !isDeleted(t));

            const columns = [
                { key: 'tenant_id', label: 'ID', format: 'number' },
                { key: 'first_name', label: 'ชื่อ' },
                { key: 'last_name', label: 'นามสกุล' },
                { key: 'phone', label: 'เบอร์โทร' },
                { key: 'id_card', label: 'เลขบัตร' },
                { key: 'occupation', label: 'อาชีพ' },
                { key: 'room_number', label: 'ห้อง' },
                { key: 'contract_status', label: 'สถานะสัญญา' }
            ];

            if (type === 'excel') {
                generateExcel('ทะเบียนผู้เช่า', 'ผู้เช่า', columns, tenants);
                showNotification('✅ สร้าง Excel สำเร็จ', 'success');
            } else {
                generatePDF('ทะเบียนผู้เช่า', `ทั้งหมด ${tenants.length} คน`, columns, tenants);
            }
        } catch (err) {
            console.error('❌', err);
            showNotification('❌ ' + err.message, 'error');
        } finally {
            hideLoading();
        }
    }

    // ==========================================
    // Report 3: ทะเบียนสัญญา
    // ==========================================
    async function exportContractReport(type) {
        const buildingId = getCurrentBuildingId();
        if (!buildingId) return showNotification('⚠️ กรุณาเลือกอาคาร', 'error');

        showLoading('กำลังโหลดสัญญา...');
        try {
            const url = `${API_BASE}/contracts?building_id=${buildingId}&_t=${Date.now()}`;
            const raw = await fetchJson(url);
            const contracts = toArray(raw).filter(c => !isDeleted(c));

            const columns = [
                { key: 'contract_number', label: 'เลขที่สัญญา' },
                { key: 'room_number', label: 'ห้อง' },
                { key: 'tenant_name', label: 'ผู้เช่า' },
                { key: 'start_date', label: 'วันเริ่ม', format: 'date_th' },
                { key: 'end_date', label: 'วันครบขั้นต่ำ', format: 'date_th' },
                { key: 'rent_price', label: 'ค่าเช่า (฿)', format: 'money' },
                { key: 'deposit_amount', label: 'ประกัน (฿)', format: 'money' },
                { key: 'status', label: 'สถานะ' }
            ];

            if (type === 'excel') {
                generateExcel('ทะเบียนสัญญา', 'สัญญา', columns, contracts);
                showNotification('✅ สร้าง Excel สำเร็จ', 'success');
            } else {
                generatePDF('ทะเบียนสัญญา', `ทั้งหมด ${contracts.length} สัญญา`, columns, contracts);
            }
        } catch (err) {
            console.error('❌', err);
            showNotification('❌ ' + err.message, 'error');
        } finally {
            hideLoading();
        }
    }

    // ==========================================
    // Report 4: ประวัติการชำระ
    // ==========================================
    async function exportPaymentReport(type) {
        const buildingId = getCurrentBuildingId();
        if (!buildingId) return showNotification('⚠️ กรุณาเลือกอาคาร', 'error');

        showLoading('กำลังโหลดประวัติชำระ...');
        try {
            const url = `${API_BASE}/payments?building_id=${buildingId}&_t=${Date.now()}`;
            const raw = await fetchJson(url);
            const payments = toArray(raw).filter(p => !isDeleted(p));

            const columns = [
                { key: 'vol_no', label: 'เลขที่บิล' },
                { key: 'billing_month', label: 'เดือน' },
                { key: 'room_number', label: 'ห้อง' },
                { key: 'tenant_name', label: 'ผู้เช่า' },
                { key: 'total_amount', label: 'ยอดรวม (฿)', format: 'money' },
                { key: 'paid_amount', label: 'ชำระแล้ว (฿)', format: 'money' },
                { key: 'paid_date', label: 'วันที่ชำระ', format: 'date_th' },
                { key: 'is_paid', label: 'สถานะ' }
            ];

            payments.forEach(p => {
                p.is_paid = isPaid(p) ? '✅ ชำระแล้ว' : '❌ ยังไม่ชำระ';
            });

            if (type === 'excel') {
                generateExcel('ประวัติการชำระ', 'การชำระ', columns, payments);
                showNotification('✅ สร้าง Excel สำเร็จ', 'success');
            } else {
                generatePDF('ประวัติการชำระ', `ทั้งหมด ${payments.length} รายการ`, columns, payments);
            }
        } catch (err) {
            console.error('❌', err);
            showNotification('❌ ' + err.message, 'error');
        } finally {
            hideLoading();
        }
    }

    // ==========================================
    // Report 5: รายงานห้องว่าง
    // ==========================================
    async function exportVacantReport(type) {
        const buildingId = getCurrentBuildingId();
        if (!buildingId) return showNotification('⚠️ กรุณาเลือกอาคาร', 'error');

        showLoading('กำลังโหลดห้องว่าง...');
        try {
            const url = `${API_BASE}/rooms?building_id=${buildingId}&_t=${Date.now()}`;
            const raw = await fetchJson(url);
            const allRooms = toArray(raw).filter(r => !isDeleted(r));
            const vacant = allRooms.filter(r => normalizeStatus(r.status) === 'AVAILABLE');

            const columns = [
                { key: 'room_number', label: 'เลขห้อง' },
                { key: 'room_type', label: 'ประเภท' },
                { key: 'default_price', label: 'ราคา/เดือน (฿)', format: 'money' },
                { key: 'status', label: 'สถานะ' }
            ];

            if (type === 'excel') {
                generateExcel('รายงานห้องว่าง', 'ห้องว่าง', columns, vacant);
                showNotification('✅ สร้าง Excel สำเร็จ', 'success');
            } else {
                generatePDF('รายงานห้องว่าง', `ห้องว่าง ${vacant.length} / ${allRooms.length} ห้อง`, columns, vacant);
            }
        } catch (err) {
            console.error('❌', err);
            showNotification('❌ ' + err.message, 'error');
        } finally {
            hideLoading();
        }
    }

    // ==========================================
    // Report 6: รายงานค้างชำระ
    // ==========================================
    async function exportOverdueReport(type) {
        const buildingId = getCurrentBuildingId();
        if (!buildingId) return showNotification('⚠️ กรุณาเลือกอาคาร', 'error');

        showLoading('กำลังโหลดรายการค้างชำระ...');
        try {
            const url = `${API_BASE}/payments?building_id=${buildingId}&_t=${Date.now()}`;
            const raw = await fetchJson(url);
            const allPayments = toArray(raw).filter(p => !isDeleted(p));
            const unpaid = allPayments.filter(p => !isPaid(p));

            const now = new Date();
            const columns = [
                { key: 'vol_no', label: 'เลขที่บิล' },
                { key: 'billing_month', label: 'เดือน' },
                { key: 'room_number', label: 'ห้อง' },
                { key: 'tenant_name', label: 'ผู้เช่า' },
                { key: 'tenant_phone', label: 'เบอร์โทร' },
                { key: 'total_amount', label: 'ยอดค้าง (฿)', format: 'money' },
                { key: 'due_date', label: 'กำหนดชำระ', format: 'date_th' },
                { key: 'overdue_days', label: 'ค้าง (วัน)', format: 'number' }
            ];

            unpaid.forEach(p => {
                if (p.due_date) {
                    const due = new Date(p.due_date);
                    if (!isNaN(due.getTime())) {
                        const days = Math.floor((now - due) / (1000 * 60 * 60 * 24));
                        p.overdue_days = days > 0 ? days : 0;
                    } else {
                        p.overdue_days = 0;
                    }
                } else {
                    p.overdue_days = 0;
                }
            });

            unpaid.sort((a, b) => (b.overdue_days || 0) - (a.overdue_days || 0));

            const totalDebt = unpaid.reduce((sum, p) => sum + (parseFloat(p.total_amount) || 0), 0);
            const subtitle = `ยอดค้างรวม: ${formatNumber(totalDebt)} ฿ (${unpaid.length} รายการ)`;

            if (type === 'excel') {
                generateExcel('รายงานค้างชำระ', 'ค้างชำระ', columns, unpaid);
                showNotification('✅ สร้าง Excel สำเร็จ', 'success');
            } else {
                generatePDF('รายงานค้างชำระ', subtitle, columns, unpaid);
            }
        } catch (err) {
            console.error('❌', err);
            showNotification('❌ ' + err.message, 'error');
        } finally {
            hideLoading();
        }
    }

    // ==========================================
    // Export to window
    // ==========================================
    window.exportIncomeReport = exportIncomeReport;
    window.exportTenantReport = exportTenantReport;
    window.exportContractReport = exportContractReport;
    window.exportPaymentReport = exportPaymentReport;
    window.exportVacantReport = exportVacantReport;
    window.exportOverdueReport = exportOverdueReport;

    // ==========================================
    // Init
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 reports.js v3 เริ่มทำงาน');

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const startOfYear = `${now.getFullYear()}-01`;
        document.getElementById('startMonth').value = startOfYear;
        document.getElementById('endMonth').value = currentMonth;

        lastBuildingId = getCurrentBuildingId();
        setInterval(() => {
            const cur = getCurrentBuildingId();
            if (cur !== lastBuildingId) {
                lastBuildingId = cur;
            }
        }, 1000);

        console.log('✅ reports.js v3 โหลดสำเร็จ');
    });

})();
