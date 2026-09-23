import * as XLSX from 'xlsx';

// sheets: { 'Tên sheet': [ {cột: giá trị}, ... ] }
export function exportSheets(fileName, sheets) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'Không có dữ liệu' }]);
    const cols = Object.keys(rows[0] || { '': '' });
    ws['!cols'] = cols.map((c) => ({
      wch: Math.min(50, Math.max(c.length, ...rows.slice(0, 200).map((r) => String(r[c] ?? '').length)) + 2),
    }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  });
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}
