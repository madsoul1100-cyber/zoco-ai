import { useState } from "react";
import { LANGUAGES, languageLabel } from "../lib/languages.js";
import {
  INSTRUCTION_SECTION_TITLES,
  MLC_INSTRUCTION_PACK,
  compileInstructions,
  mergeOutputVars,
  resolveInstructionSections,
  sectionFromTitle,
  splitInstructionText,
} from "../lib/instructionPacks.js";

const BUILTIN_VARS = [
  { key: "customer_name", description: "The caller's name" },
  { key: "phone", description: "The caller's phone number" },
  { key: "agent_name", description: "This agent's name" },
  { key: "language", description: "Spoken language code" },
];

export function InstructionsPanel({
  agent,
  onChange,
  onGreetingChange,
  onInsertVar,
  onReview,
  translationsOpen,
  setTranslationsOpen,
  translateTo,
  setTranslateTo,
  translating,
  onTranslateGreeting,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [view, setView] = useState("sections");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [fullDraft, setFullDraft] = useState("");
  const sections = resolveInstructionSections(agent);

  function commit(nextSections, extras = {}) {
    const compiled = compileInstructions(nextSections);
    onChange({
      ...agent,
      ...extras,
      instructionSections: nextSections,
      instructions: compiled,
      persona: compiled,
    });
  }

  function addSection(title, custom = false) {
    const next = [...sections, sectionFromTitle(title, { custom })];
    const extras = title === "Output fields" ? { outputVariables: mergeOutputVars(agent) } : {};
    commit(next, extras);
    setPickerOpen(false);
  }

  function updateSection(id, patch) {
    commit(sections.map((section) => (section.id === id ? { ...section, ...patch } : section)));
  }

  function moveSection(index, delta) {
    const next = [...sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  }

  function applyPastedPrompt(text) {
    const next = splitInstructionText(text);
    commit(next);
    setPasteOpen(false);
    setPasteDraft("");
    setView("sections");
  }

  const usedTitles = new Set(sections.map((section) => section.title));

  return (
    <div className="builder-doc-wrap">
      <h2>Instructions</h2>
      <section className="builder-greeting">
        <div className="builder-section-head">
          <strong>Greeting</strong>
          <button className="link-quiet" type="button" onClick={() => setTranslationsOpen((open) => !open)}>
            Translations
          </button>
        </div>
        <textarea
          className="builder-greeting-input"
          value={agent.greeting || ""}
          onChange={(e) => onGreetingChange(e.target.value)}
          placeholder={`Hi {{ customer_name }}, this is ${agent.name}. Is now a good time?`}
        />
        <div className="builder-chips">
          {BUILTIN_VARS.map((item) => (
            <button key={item.key} type="button" className="chip" onClick={() => onInsertVar(item.key)}>
              {`{{ ${item.key} }}`}
            </button>
          ))}
        </div>
        {translationsOpen ? (
          <div className="builder-translations">
            <div className="row">
              <select className="input" value={translateTo} onChange={(e) => setTranslateTo(e.target.value)}>
                <option value="">Translate greeting to…</option>
                {LANGUAGES.filter((lang) => lang.code !== "en-IN").map((lang) => (
                  <option key={lang.code} value={lang.code}>{languageLabel(lang.code)}</option>
                ))}
              </select>
              <button className="btn ghost" type="button" disabled={!translateTo || translating} onClick={() => onTranslateGreeting(translateTo)}>
                {translating ? "Translating…" : "Translate"}
              </button>
            </div>
            <ul className="plain-list">
              {Object.entries(agent.greetings || {}).filter(([key]) => !key.includes(":")).map(([code, text]) => (
                <li key={code}><code>{code}</code> {text}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="toolbar-row instruction-toolbar">
        <div className="subtabs">
          <button type="button" className={view === "sections" ? "on" : ""} onClick={() => setView("sections")}>Sections</button>
          <button
            type="button"
            className={view === "full" ? "on" : ""}
            onClick={() => {
              setFullDraft(compileInstructions(sections));
              setView("full");
            }}
          >
            Full prompt
          </button>
        </div>
        <div className="row">
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setPasteDraft(compileInstructions(sections));
              setPasteOpen(true);
            }}
          >
            Paste prompt
          </button>
          {view === "sections" ? (
            <button className="btn" type="button" onClick={() => setPickerOpen(true)}>+ Add instruction</button>
          ) : null}
        </div>
      </div>

      {view === "full" ? (
        <div className="full-prompt">
          <p className="muted">Paste a whole prompt from another tool, or edit it as one block. Headings such as Role and approved boundary become sections automatically.</p>
          <textarea
            className="builder-doc"
            value={fullDraft}
            onChange={(e) => setFullDraft(e.target.value)}
            placeholder="Paste the full agent prompt here…"
          />
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
            <button className="btn ghost" type="button" onClick={() => { setFullDraft(compileInstructions(sections)); setView("sections"); }}>Cancel</button>
            <button className="btn" type="button" onClick={() => applyPastedPrompt(fullDraft)}>Apply prompt</button>
          </div>
        </div>
      ) : sections.length === 0 ? (
        <div className="empty-state">
          <h3>Add the playbook one section at a time</h3>
          <p className="muted">
            The greeting above is already played on the call — do not repeat it in the prompt.
            Start with Role and approved boundary, then add Priority, Voice, Language, and the rest, the same way Priya’s Graduate MLC agent is built.
          </p>
          <button className="btn" type="button" onClick={() => setPickerOpen(true)}>+ Add instruction</button>
        </div>
      ) : (
        sections.map((section, index) => (
          <section key={section.id} className="instruction-section">
            <div className="builder-section-head">
              <input
                className="instruction-section-title"
                value={section.title}
                onChange={(e) => updateSection(section.id, { title: e.target.value })}
              />
              <div className="instruction-section-actions">
                <button className="link-quiet" type="button" disabled={index === 0} onClick={() => moveSection(index, -1)}>Up</button>
                <button className="link-quiet" type="button" disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)}>Down</button>
                <button className="link-quiet" type="button" onClick={() => commit(sections.filter((item) => item.id !== section.id))}>Remove</button>
              </div>
            </div>
            <textarea
              className="instruction-section-body"
              value={section.body || ""}
              onChange={(e) => updateSection(section.id, { body: e.target.value })}
              placeholder="Write this part of the prompt…"
            />
          </section>
        ))
      )}

      {view === "sections" && sections.length ? (
        <button className="btn ghost instruction-add" type="button" onClick={() => setPickerOpen(true)}>
          + Add instruction
        </button>
      ) : null}

      <button className="builder-review" type="button" onClick={onReview}>
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 3l1.4 6.1L19 12l-5.6 2.9L12 21l-1.4-6.1L5 12l5.6-2.9L12 3z" fill="currentColor" />
        </svg>
        Review agent
      </button>

      {pickerOpen ? (
        <div className="modal-back" onClick={() => setPickerOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="builder-section-head">
              <h3>Add instruction</h3>
              <button className="icon-btn" type="button" onClick={() => setPickerOpen(false)}>×</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Add one heading at a time. Graduate MLC pack fills Priya’s approved prompt for that section.
            </p>
            <div className="section-picker">
              {INSTRUCTION_SECTION_TITLES.map((title) => {
                const used = usedTitles.has(title);
                const packed = Boolean(MLC_INSTRUCTION_PACK[title]);
                return (
                  <button
                    key={title}
                    type="button"
                    className="section-pick"
                    disabled={used}
                    onClick={() => addSection(title)}
                  >
                    <strong>{title}</strong>
                    <span className="muted">{used ? "Already added" : packed ? "Graduate MLC pack" : "Blank section"}</span>
                  </button>
                );
              })}
              <button type="button" className="section-pick" onClick={() => addSection("New instruction", true)}>
                <strong>Custom heading</strong>
                <span className="muted">Blank section with your own title</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pasteOpen ? (
        <div className="modal-back" onClick={() => setPasteOpen(false)}>
          <div className="modal prompt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="builder-section-head">
              <h3>Paste prompt</h3>
              <button className="icon-btn" type="button" onClick={() => setPasteOpen(false)}>×</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Replace the current instructions with text from Sarvam or another builder. Named headings split into sections; otherwise it stays as one prompt.
            </p>
            <textarea
              className="paste-prompt"
              value={pasteDraft}
              onChange={(e) => setPasteDraft(e.target.value)}
              placeholder="Paste the full prompt here…"
            />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn ghost" type="button" onClick={() => setPasteOpen(false)}>Cancel</button>
              <button className="btn" type="button" disabled={!pasteDraft.trim()} onClick={() => applyPastedPrompt(pasteDraft)}>Replace instructions</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
