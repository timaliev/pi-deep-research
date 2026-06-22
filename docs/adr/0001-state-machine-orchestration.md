# State-machine orchestration via agent injections

Deep Research tools (`run_research`, `plan_research`) use a **state machine driven by repeated agent invocations with prompt injections**, rather than agent-orchestrated tool calls or an autonomous subprocess. Each call advances the state machine by one or more phases, injects a reasoning prompt into the agent conversation, and returns. The agent must call the tool again after processing the injection.

**Considered Options**

- **Agent-orchestrated**: Register simple tools (`web_search`, `scrape_url`) and let the Pi agent drive the entire research loop through its own reasoning. Rejected because: (a) intermediate search/scrape results fill the context window, (b) the agent may skip iterations or forget to call tools in the correct order, (c) no concurrency for parallel searches.

- **Autonomous subprocess**: Run GPT Researcher as a child process, passing the Pi model configuration. Rejected because: (a) Pi extensions cannot reliably share the active LLM model with an external process, (b) would duplicate the LLM provider configuration outside Pi, (c) loses Pi-native UI integration (`ctx.ui.notify`, progress reporting).

- **State machine with injections (chosen)**: The extension tool manages research state across invocations via `pi.appendEntry()`. For reasoning steps that require the LLM, the tool injects a prompt via `pi.sendUserMessage()` and returns `{ phase: "awaiting_X" }`. The agent processes the injection in its next turn, then calls the tool again. This keeps the Pi LLM as the sole reasoning engine while the tool controls research flow, concurrency, budget limits, and artifact management.

**Consequences**

- The agent must follow the skill protocol strictly: after every `run_research` response, call it again until `phase: "done"`. Without this discipline, the state machine stalls.
- `pi.appendEntry()` is the persistence mechanism for research state. The state survives session restarts.
- Debugging requires reading the research log (`./deep-research/logs/`), as the state machine transitions are not visible in the chat.
