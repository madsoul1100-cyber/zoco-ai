export function parseCsv(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, phone, notes] = line.split(",").map((part) => part.trim());
      if (!phone && name) return { name: "Customer", phone: name, notes: "" };
      return { name: name || "Customer", phone, notes: notes || "" };
    })
    .filter((row) => row.phone);
}
