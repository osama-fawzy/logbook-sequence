// إدارة البيانات وتصدير ملفات PDF
document.addEventListener('DOMContentLoaded', () => {
    loadLogEntries();
    updateReportDate();

    const form = document.getElementById('entryForm');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            saveEntry();
        });
    }
});

function updateReportDate() {
    const dateElement = document.getElementById('reportDate');
    if (dateElement) {
        const now = new Date();
        dateElement.innerText = `تاريخ التقرير: ${now.toLocaleDateString('ar-EG')} - ${now.toLocaleTimeString('ar-EG')}`;
    }
}

function saveEntry() {
    const type = document.getElementById('type').value;
    const subject = document.getElementById('subject').value;
    const sender = document.getElementById('sender').value;
    const receiver = document.getElementById('receiver').value;
    const details = document.getElementById('details').value;

    const entry = {
        id: Date.now(),
        date: new Date().toLocaleDateString('ar-EG'),
        type,
        subject,
        sender,
        receiver,
        details
    };

    let entries = JSON.parse(localStorage.getItem('logEntries') || '[]');
    entries.push(entry);
    localStorage.setItem('logEntries', JSON.stringify(entries));

    document.getElementById('entryForm').reset();
    loadLogEntries();
}

function loadLogEntries() {
    const tableBody = document.getElementById('tableBody');
    if (!tableBody) return;

    let entries = JSON.parse(localStorage.getItem('logEntries') || '[]');
    tableBody.innerHTML = '';

    entries.forEach((item, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${item.date}</td>
            <td>${item.type}</td>
            <td><strong>${item.subject}</strong></td>
            <td>${item.sender}</td>
            <td>${item.receiver}</td>
            <td>${item.details || '-'}</td>
        `;
        tableBody.appendChild(row);
    });
}

// دالة تصدير ملفات PDF لكافة أو أي نوع رسائل
function exportToPDF() {
    const element = document.getElementById('pdfContent');
    
    // إعدادات تصدير PDF يدعم اللغة العربية وجودة الطباعة
    const opt = {
        margin:       0.5,
        filename:     `سجل_الرسائل_${new Date().toISOString().slice(0,10)}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'landscape' }
    };

    // تشغيل عملية تحويل HTML إلى PDF
    html2pdf().set(opt).from(element).save();
}