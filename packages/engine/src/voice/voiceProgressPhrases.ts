/** Max spoken words for live voice progress fillers (keep TTS snappy). */
export const VOICE_PROGRESS_MAX_WORDS = 7;

export function clipVoiceProgressWords(text: string, maxWords = VOICE_PROGRESS_MAX_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ');
}

const TOOL_PHRASES: Record<string, string> = {
  web_search: 'Searching the web.',
  deep_web_search: 'Searching deeper.',
  web_fetch: 'Fetching a page.',
  web_scrape: 'Scraping the web.',
  knowledge_base_search: 'Checking knowledge.',
  cortex_memory_search: 'Checking memory.',
  memory_recall: 'Recalling memory.',
  codebase_search: 'Searching codebase.',
  code_search: 'Searching code.',
  shell: 'Running command.',
  shell_exec: 'Running command.',
  file_write: 'Writing a file.',
  file_edit: 'Editing a file.',
  file_read: 'Reading a file.',
  delegate_to_subagent: 'Running a helper.',
  crew_member: 'Crew is working.',
  git_commit: 'Committing changes.',
  git_push: 'Pushing changes.',
  test_run: 'Running tests.',
  http_get: 'Fetching data.',
  web_browse: 'Browsing the web.',
};

const STAGE_PHRASES: Record<string, string> = {
  thinking: 'Thinking.',
  execution: 'Working on it.',
  tree_of_thoughts: 'Reasoning.',
  crew_mission: 'Crew mission.',
  crew_private: 'Working on it.',
  crew_routing: 'Routing crew.',
  research: 'Researching.',
  receiving: 'On it.',
};

export const SHORT_VOICE_ACK_PHRASES = [
  'On it.',
  'One moment.',
  'Right away.',
  'Got it.',
  'Sure.',
  'Okay.',
];

const ackHistory: string[] = [];
const ACK_HISTORY_SIZE = 5;

export function pickShortVoiceAck(): string {
  if (SHORT_VOICE_ACK_PHRASES.length <= ACK_HISTORY_SIZE) {
    return SHORT_VOICE_ACK_PHRASES[Math.floor(Math.random() * SHORT_VOICE_ACK_PHRASES.length)]!;
  }
  const available = SHORT_VOICE_ACK_PHRASES.filter((p) => !ackHistory.includes(p));
  const pick = available[Math.floor(Math.random() * available.length)]!;
  ackHistory.push(pick);
  if (ackHistory.length > ACK_HISTORY_SIZE) ackHistory.shift();
  return pick;
}

export function voiceProgressLineForTool(tool: string, description?: string): string | null {
  const id = tool.trim();
  if (!id) return null;
  if (TOOL_PHRASES[id]) return TOOL_PHRASES[id];

  const desc = description?.replace(/\s+/g, ' ').trim();
  if (desc) {
    const clipped = clipVoiceProgressWords(desc);
    if (clipped) {
      const punct = /[.!?]$/.test(clipped) ? '' : '.';
      return `${clipped}${punct}`;
    }
  }

  const label = id.replace(/_/g, ' ');
  return `${clipVoiceProgressWords(label)}.`;
}

export function voiceProgressLineForStage(stage: string): string | null {
  const key = stage.trim().toLowerCase();
  if (!key) return 'Still working.';
  if (STAGE_PHRASES[key]) return STAGE_PHRASES[key];
  if (key.includes('web') || key.includes('search')) return 'Searching now.';
  if (key.includes('think')) return 'Thinking.';
  if (key.includes('crew')) return 'Crew working.';
  return 'Still working.';
}
