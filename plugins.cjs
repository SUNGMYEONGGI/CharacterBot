// Reads a plugin folder: a manifest plus bundled MCP servers and skills.
// Accepts this app's `plugin.json` and the Claude Code / Cursor layouts
// (`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.mcp.json`).
const fs = require('node:fs');
const path = require('node:path');

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

// Minimal YAML frontmatter: `key: value` lines between --- fences.
function parseSkillFile(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2].trim() };
}

function readPlugin(dir) {
  const manifest = readJson(path.join(dir, 'plugin.json'))
    || readJson(path.join(dir, '.claude-plugin', 'plugin.json'))
    || readJson(path.join(dir, '.cursor-plugin', 'plugin.json'));
  if (!manifest?.name) throw new Error('plugin.json(또는 .claude-plugin/plugin.json)에 name이 필요합니다');

  const mcpServers = manifest.mcpServers && typeof manifest.mcpServers === 'object'
    ? manifest.mcpServers
    : readJson(path.join(dir, '.mcp.json'))?.mcpServers || {};

  const skills = [];
  const skillsDir = path.join(dir, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      const file = entry.isDirectory() ? path.join(skillsDir, entry.name, 'SKILL.md') : path.join(skillsDir, entry.name);
      if (!file.endsWith('.md') || !fs.existsSync(file)) continue;
      const { meta, body } = parseSkillFile(fs.readFileSync(file, 'utf8'));
      skills.push({ name: meta.name || entry.name.replace(/\.md$/, ''), description: meta.description || '', body });
    }
  }
  // ${CLAUDE_PLUGIN_ROOT} lets bundled servers point at files inside the plugin.
  const servers = JSON.parse(JSON.stringify(mcpServers).replaceAll('${CLAUDE_PLUGIN_ROOT}', dir.replaceAll('\\', '\\\\')));
  return { name: manifest.name, description: manifest.description || '', version: manifest.version || '', mcpServers: servers, skills };
}

module.exports = { readPlugin, parseSkillFile };
