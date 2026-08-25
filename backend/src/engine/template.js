export function templateVars(agent, customer = {}) {
  const extras = {};
  for (const item of agent?.inputVariables || agent?.variables || []) {
    const key = String(item?.key || "").trim();
    if (!key) continue;
    extras[key] = item.defaultValue || item.value || item.example || "";
  }
  return {
    agent_name: agent?.name || "",
    language: agent?.language || "",
    customer_name: customer.name || customer.customer_name || extras.customer_name || "",
    phone: customer.phone || extras.phone || "",
    ...extras,
  };
}

export function fillTemplate(text, vars = {}) {
  const filled = String(text || "").replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
  return filled.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
}

export function renderGreeting(agent, customer = {}) {
  return fillTemplate(agent?.greeting || "", templateVars(agent, customer));
}
