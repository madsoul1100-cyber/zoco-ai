import { normalizePhone } from "../phone.js";

function fillTemplate(value, vars = {}) {
  return String(value || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_all, key) => {
    const found = vars[key] ?? vars[key.split(".").pop()] ?? "";
    return found == null ? "" : String(found);
  });
}

export function toolVars(agent, call, slots = {}) {
  const customer = call?.customer || {};
  const gathered = { ...(call?.gathered || {}), ...slots };
  const inputs = Object.fromEntries((agent?.inputVariables || []).map((item) => [item.key, item.defaultValue || ""]));
  return {
    ...inputs,
    ...gathered,
    ...customer,
    customer_name: customer.name || gathered.name || inputs.customer_name || "",
    phone: customer.phone || "",
    agent_name: agent?.name || "",
  };
}

export function openAiTools(agent) {
  const tools = [
    {
      type: "function",
      function: {
        name: "query_knowledge",
        description: "Look up facts from attached knowledge bases. Use when the caller asks a factual question.",
        parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
      },
    },
    {
      type: "function",
      function: {
        name: "end_interaction",
        description:
          "End the call only after speaking the required closing line from the Instructions (for example సరే అండి). Always pass goodbye with that exact spoken line, then disposition.",
        parameters: {
          type: "object",
          properties: {
            disposition: { type: "string", description: "not_interested | do_not_call | success | callback_requested | wrong_person" },
            goodbye: { type: "string", description: "The exact short closing line spoken to the caller before hangup" },
          },
          required: ["goodbye", "disposition"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "transfer_to_human",
        description: "Warm-transfer the live call to a human. Speak a one-line handoff first.",
        parameters: {
          type: "object",
          properties: { reason: { type: "string" }, number: { type: "string" } },
        },
      },
    },
  ];
  for (const tool of agent?.customTools || []) {
    if (!tool?.name) continue;
    tools.push({
      type: "function",
      function: {
        name: toolName(tool),
        description: tool.description || `Call the ${tool.name} HTTP API`,
        parameters: {
          type: "object",
          properties: { note: { type: "string" } },
        },
      },
    });
  }
  return tools;
}

export function toolName(tool) {
  return String(tool.name || tool.id || "custom_tool").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40);
}

export async function runToolCall({ name, args, agent, call, slots, knowledgeFn }) {
  if (name === "query_knowledge") {
    const question = args.question || args.q || "";
    const text = knowledgeFn ? await knowledgeFn(agent, question) : "";
    return { ok: true, result: text || "No matching knowledge." };
  }
  if (name === "end_interaction") {
    const goodbye = String(args.goodbye || args.message || args.closing || "").trim();
    return {
      ok: true,
      endCall: true,
      disposition: args.disposition || "not_interested",
      say: goodbye,
      result: goodbye ? `Ended with: ${goodbye}` : "End the call after speaking the required closing line.",
    };
  }
  if (name === "transfer_to_human") {
    const number = normalizePhone(args.number || agent.transferNumber || "");
    if (!number) return { ok: false, result: "No transfer number configured on this agent." };
    return { ok: true, transfer: number, reason: args.reason || "handoff" };
  }
  const tool = (agent.customTools || []).find((item) => toolName(item) === name);
  if (!tool) return { ok: false, result: `Unknown tool ${name}` };
  return runHttpTool(tool, toolVars(agent, call, slots));
}

export async function runHttpTool(tool, vars) {
  const url = fillTemplate(tool.url || tool.endpoint, vars);
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, result: "This custom tool needs an https URL." };
  }
  const method = String(tool.method || "POST").toUpperCase();
  const headers = { "Content-Type": "application/json", ...(tool.headers || {}) };
  Object.keys(headers).forEach((key) => {
    headers[key] = fillTemplate(headers[key], vars);
  });
  const body = method === "GET" || method === "HEAD" ? undefined : fillTemplate(tool.bodyTemplate || tool.body || "{}", vars);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      result: text.slice(0, 1500) || `${response.status} ${response.statusText}`,
    };
  } catch (error) {
    return { ok: false, result: error.message };
  } finally {
    clearTimeout(timer);
  }
}
