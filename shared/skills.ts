/**
 * Skills: folders of know-how the Copilot loads when a task calls for it — the
 * same SKILL.md format Claude uses. A skill is a SKILL.md with a little YAML
 * frontmatter (name, description) and markdown instructions, plus any files
 * it refers to. Only names and descriptions sit in the Copilot's instructions;
 * the body loads when the Copilot decides the skill applies (use_skill).
 */

export type SkillSource = 'builtin' | 'user' | 'claude'

export interface SkillInfo {
  /** Unique across sources: "builtin:motion-craft", "user:my-skill", "claude:pdf". */
  key: string
  source: SkillSource
  /** The folder name (user / Claude skills) or built-in id. */
  folder: string
  name: string
  description: string
  /** Other files in the skill's folder, relative paths. */
  files: string[]
}

export interface SkillDoc extends SkillInfo {
  /** The instructions: SKILL.md without its frontmatter. */
  body: string
}

/** Splits SKILL.md into its frontmatter fields and body. Tolerates missing or sloppy frontmatter. */
export function parseSkill(text: string): { name?: string; description?: string; body: string } {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src)
  if (!m) return { body: src.trim() }
  const fields: Record<string, string> = {}
  let key: string | null = null
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv) {
      key = kv[1].toLowerCase()
      const said = kv[2].trim()
      // The sign of a folded or kept block (">", "|-") isn't part of a description. In quotes it is text like any other.
      fields[key] = key === 'description' && !inQuotes(said) ? said.replace(/^[>|]-?\s*/, '') : unquote(said)
    } else if (key && /^\s+\S/.test(line)) {
      // A folded continuation line.
      fields[key] = `${fields[key]} ${line.trim()}`.trim()
    }
  }
  const body = src.slice(m[0].length).trim()
  return { name: fields.name || undefined, description: fields.description || undefined, body }
}

function inQuotes(t: string) {
  return t.length > 1 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
}

function unquote(t: string) {
  if (!inQuotes(t)) return t
  const inner = t.slice(1, -1)
  // Between double quotes, a quote or a backslash that is part of the text has a backslash before it.
  return t[0] === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner
}

/**
 * A name or description as its line in the frontmatter says it. One that begins with a quote, ">" or "|" goes
 * between double quotes: written as it is, the reader takes its first character for a sign — a value between two
 * quotes lost them, and a description that began with ">" lost that.
 */
function scalar(s: string) {
  const t = s.replace(/\s+/g, ' ').trim()
  return /^["'>|]/.test(t) ? `"${t.replace(/[\\"]/g, '\\$&')}"` : t
}

/** A skill's description when its frontmatter has none: the first real paragraph. */
export function fallbackDescription(body: string) {
  const para = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#'))
  return (para ?? '').replace(/\s+/g, ' ').slice(0, 240)
}

/** SKILL.md text for a name, description and instructions. */
export function writeSkill(name: string, description: string, body: string) {
  return `---\nname: ${scalar(name)}\ndescription: ${scalar(description)}\n---\n\n${body.trim()}\n`
}

/** Names Windows keeps for devices: a folder can't be called one of them. */
const DEVICE_NAME = /^(con|prn|aux|nul|com\d|lpt\d)$/

/**
 * A folder name for a skill: lowercase words joined by hyphens. Letters and digits of any script are kept — a name
 * in Chinese is a name too. (Kept as ASCII only, "调色技巧" and "短视频剪辑" both came out as "skill", and the second
 * one was refused as already there.)
 */
export function skillSlug(name: string) {
  const slug = [
    ...name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-'),
  ]
    // By character, not by code unit: a cut through the middle of one leaves half a character in a folder's name.
    .slice(0, 64)
    .join('')
    .replace(/^-+|-+$/g, '')
  if (!slug) return 'skill'
  return DEVICE_NAME.test(slug) ? `skill-${slug}` : slug
}
