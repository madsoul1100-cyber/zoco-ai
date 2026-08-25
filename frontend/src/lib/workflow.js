function nid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export const STAGE_TYPES = [
  { id: "greeting", label: "Greeting" },
  { id: "stage", label: "Conversation" },
  { id: "condition", label: "Branch" },
  { id: "knowledge", label: "Query knowledge" },
  { id: "end", label: "End call" },
];

export function workflowOf(agent) {
  const raw = agent?.workflow;
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes.filter((node) => node?.id) : [];
  return {
    enabled: Boolean(raw?.enabled && nodes.length),
    nodes,
  };
}

export function seedWorkflow(agent) {
  const greeting = String(agent?.greeting || "").trim() || "Greet the caller in their language, then wait.";
  const sections = Array.isArray(agent?.instructionSections) ? agent.instructionSections : [];
  const stages = sections
    .filter((section) => String(section?.title || "").trim())
    .slice(0, 5)
    .map((section) => ({
      id: nid("stage"),
      type: "stage",
      title: String(section.title).trim(),
      body: String(section.body || "").trim().slice(0, 280) || "Follow this part of the instructions naturally.",
    }));

  const nodes = [
    {
      id: nid("greet"),
      type: "greeting",
      title: "Greeting",
      body: greeting,
    },
    ...(stages.length
      ? stages
      : [
          {
            id: nid("stage"),
            type: "stage",
            title: "Help the caller",
            body: agent?.useCase || "Understand what they need, then complete the request or capture a callback.",
          },
        ]),
  ];

  if ((agent?.knowledgeBaseIds || []).length) {
    nodes.push({
      id: nid("kb"),
      type: "knowledge",
      title: "Query knowledge",
      body: "When they ask for a fact, look it up from attached knowledge bases. Do not invent policy or product details.",
    });
  }

  nodes.push({
    id: nid("end"),
    type: "end",
    title: "End interaction",
    body: "Close politely when the goal is met, they ask to stop, or there is nothing left to do. Speak a short goodbye first.",
  });

  return { enabled: true, nodes };
}

export function patchWorkflow(agent, patch) {
  return { ...agent, workflow: { ...workflowOf(agent), ...patch } };
}

export function workflowSummary(agent) {
  const flow = workflowOf(agent);
  if (!flow.enabled) return "Not defined";
  return `${flow.nodes.length} stages`;
}
