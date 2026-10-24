// Turns the part of a conversation a bot hasn't seen yet into its next prompt.
// The SDK session keeps everything before that, so each turn only sends what's
// new: user messages and, in a group, the other bots' replies.

function userText(msg, userName, skills, group, nameOf, messages) {
  let text = msg.fromBotId ? `[${nameOf(msg.fromBotId)}이(가) 보낸 메시지]: ${msg.content}`
    : group ? `${userName}: ${msg.content}` : msg.content;
  const root = msg.threadOf && messages.find((m) => m.id === msg.threadOf);
  if (root) text = `(스레드 답장 · 원래 메시지: "${(root.content || '').slice(0, 300)}")\n${text}`;
  if (msg.event) text += `\n\n이 루틴을 깨운 이벤트:\n${msg.event}`;
  if (msg.voiceChat) text = `(음성 채팅 중 · 받아 적은 말입니다. 답은 소리 내어 읽히니 마크다운·목록 없이 말하듯 두세 문장으로 하세요)\n${text}`;
  else if (msg.voice) text = `(음성 메모를 받아 적은 내용)\n${text}`;
  const skill = msg.skillId && skills.find((s) => s.id === msg.skillId);
  if (skill) text = `[사용자가 스킬 "${skill.name}"을(를) 호출했습니다]\n${skill.body}\n\n${text}`;
  for (const a of msg.attachments || []) {
    if (a.text != null) text += `\n\n첨부 파일 ${a.name}:\n\`\`\`\n${a.text}\n\`\`\``;
  }
  return text;
}

// Returns { text, images: [{ mediaType, data }] } for messages[from..].
function pendingPrompt(conv, botId, { bots, userName, skills = [] }, from = 0) {
  const nameOf = (id) => bots.find((b) => b.id === id)?.name || 'Bot';
  const group = conv.kind === 'group';
  const parts = [];
  const images = [];
  for (const msg of conv.messages.slice(from)) {
    if (msg.role === 'user') {
      parts.push(userText(msg, userName, skills, group, nameOf, conv.messages));
      for (const a of msg.attachments || []) {
        const m = a.dataUrl?.match(/^data:([^;]+);base64,(.*)$/);
        if (m) images.push({ mediaType: m[1], data: m[2] });
      }
    } else if (msg.role === 'assistant' && msg.botId !== botId && msg.content) {
      parts.push(`[${nameOf(msg.botId)}]: ${msg.content}`);
    }
  }
  return { text: parts.join('\n\n'), images };
}

// Returns member bot ids @mentioned in text, longest names first so
// "@RO Agent" doesn't also match a bot called "RO".
function mentionedBots(text, members) {
  const lower = text.toLowerCase();
  const found = [];
  let rest = lower;
  for (const bot of [...members].sort((a, b) => b.name.length - a.name.length)) {
    const tag = `@${bot.name.toLowerCase()}`;
    if (rest.includes(tag)) {
      found.push({ id: bot.id, at: lower.indexOf(tag) });
      rest = rest.split(tag).join(' ');
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.id);
}

module.exports = { pendingPrompt, mentionedBots };
