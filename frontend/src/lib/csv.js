export function parseCsv(text) {
  const table = parseCsvTable(text);
  if (!table.rows.length) return [];
  const hasHeader = table.headers.some((item) => /phone|mobile|name/i.test(item));
  return (hasHeader ? table.rows : table.rows.map((row, index) => {
    const values = Object.values(row);
    return { name: values[0] || "Customer", phone: values[1] || values[0], notes: values[2] || "" };
  })).filter((row) => row.phone);
}

export function parseCsvTable(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const split = (line) => line.split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
  const first = split(lines[0]);
  const looksHeader = first.some((item) => /phone|mobile|name|email|city|notes/i.test(item))
    || first.every((item) => /[a-zA-Z_]/.test(item) && !/^\+?\d{8,}$/.test(item));
  if (!looksHeader) {
    const headers = first.map((_, index) => `column_${index + 1}`);
    const rows = lines.map((line) => {
      const cells = split(line);
      return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
    });
    return { headers, rows };
  }
  const headers = first.map((item, index) => item || `column_${index + 1}`);
  const rows = lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
  return { headers, rows };
}

export function guessColumnMap(headers = [], variables = []) {
  const lower = headers.map((item) => item.toLowerCase());
  const pick = (...names) => headers[lower.findIndex((item) => names.some((name) => item.includes(name)))] || "";
  const map = {
    phone: pick("phone", "mobile", "whatsapp", "number"),
    name: pick("name", "customer"),
  };
  for (const item of variables) {
    if (!item?.key) continue;
    map[item.key] = pick(item.key.replaceAll("_", " "), item.key);
  }
  return map;
}
