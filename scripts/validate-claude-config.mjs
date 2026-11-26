// Validates the project's Claude Code configuration:
// - every .claude/skills/<name>/SKILL.md has YAML frontmatter with a `name`
//   matching its folder and a non-empty `description`, plus the required sections;
// - every .claude/agents/<name>.md has frontmatter with matching `name` and a `description`;
// - the expected 15 skills and 11 agents exist.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKILLS = [
  "project-architecture", "database-architect", "rbac-security", "motorcycle-domain",
  "inventory-engine", "iranian-ecommerce", "accounting-engine", "persian-localization",
  "bilingual-content", "ecommerce-frontend", "admin-dashboard", "page-builder",
  "ecommerce-seo", "performance-engineering", "quality-security-audit",
];
const AGENTS = [
  "principal-architect", "frontend-designer", "backend-engineer", "database-engineer",
  "motorcycle-domain-expert", "security-auditor", "accounting-engineer", "inventory-specialist",
  "seo-specialist", "qa-engineer", "devops-engineer",
];
const SKILL_SECTIONS = [
  "Activation conditions", "Purpose", "Workflow", "Technical requirements",
  "Security requirements", "Expected outputs", "Documentation references", "Testing requirements",
];

const errors = [];

function frontmatter(file) {
  const text = readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) {
    errors.push(`${file}: missing YAML frontmatter`);
    return { fields: {}, body: text };
  }
  const fields = {};
  for (const line of match[1].split("\n")) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

const skillsDir = ".claude/skills";
const foundSkills = existsSync(skillsDir)
  ? readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory())
  : [];
for (const name of SKILLS) if (!foundSkills.includes(name)) errors.push(`missing skill: ${name}`);
for (const dir of foundSkills) {
  const file = join(skillsDir, dir, "SKILL.md");
  if (!existsSync(file)) {
    errors.push(`${dir}: SKILL.md missing`);
    continue;
  }
  const { fields, body } = frontmatter(file);
  if (fields.name !== dir) errors.push(`${file}: name "${fields.name}" does not match folder "${dir}"`);
  if (!fields.description) errors.push(`${file}: description is empty`);
  for (const section of SKILL_SECTIONS) {
    if (!new RegExp(`^## ${section}`, "m").test(body)) errors.push(`${file}: missing section "${section}"`);
  }
}

const agentsDir = ".claude/agents";
const foundAgents = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")) : [];
for (const name of AGENTS) if (!foundAgents.includes(`${name}.md`)) errors.push(`missing agent: ${name}`);
for (const file of foundAgents) {
  const { fields } = frontmatter(join(agentsDir, file));
  const expected = file.replace(/\.md$/, "");
  if (fields.name !== expected) errors.push(`${file}: name "${fields.name}" does not match file name`);
  if (!fields.description) errors.push(`${file}: description is empty`);
}

if (!existsSync(".claude/CLAUDE.md")) errors.push("missing .claude/CLAUDE.md");

if (errors.length) {
  console.error(`Claude config validation failed (${errors.length}):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Claude config OK: ${foundSkills.length} skills, ${foundAgents.length} agents, CLAUDE.md present.`);
