// Full-text search over past messages, used by the ⌘K palette and by the
// search_conversations tool.
import type { Conv, Message } from './types';

export interface Hit {
  conv: Conv;
  msg: Message;
  snippet: string;
}

// Every word of the query must appear (case-insensitive). Newest first.
export function searchMessages(convs: Conv[], query: string, limit = 20): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: Hit[] = [];
  for (const conv of convs) {
    for (const msg of conv.messages) {
      if (msg.role === 'tool' || msg.brief || !msg.content) continue;
      const text = msg.content.toLowerCase();
      if (words.every((w) => text.includes(w))) hits.push({ conv, msg, snippet: snippet(msg.content, text.indexOf(words[0])) });
    }
  }
  return hits.sort((a, b) => b.msg.ts - a.msg.ts).slice(0, limit);
}

function snippet(content: string, at: number, width = 120): string {
  const start = Math.max(0, at - 30);
  const flat = content.slice(start, start + width).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${flat}${start + width < content.length ? '…' : ''}`;
}
