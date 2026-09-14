#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = await fs.readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
const metadata = await fs.readFile(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
const frontmatter = skill.match(/^---\n([\s\S]+?)\n---\n/);

const errors = [];
if (!frontmatter) errors.push('SKILL.md must begin with YAML frontmatter.');
if (!/^name:\s*next-or-not\s*$/m.test(frontmatter?.[1] ?? '')) errors.push('Frontmatter name must be next-or-not.');
if (!/^description:\s*\S.+$/m.test(frontmatter?.[1] ?? '')) errors.push('Frontmatter must include a non-empty description.');
if (!/^interface:\s*$/m.test(metadata)) errors.push('agents/openai.yaml must include interface metadata.');
if (!/default_prompt:\s*"[^"]*\$next-or-not[^"]*"/.test(metadata)) errors.push('default_prompt must mention $next-or-not.');
if (!/allow_implicit_invocation:\s*true/.test(metadata)) errors.push('Implicit invocation policy must remain enabled.');

if (errors.length) {
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Skill metadata is valid.\n');
}
