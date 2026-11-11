#!/usr/bin/env python3
"""Enforce the Poise token contract.

tokens.css is the only file allowed to hold raw values. Every other stylesheet
and page may only use semantic tokens:

  1. no raw colours (hex, rgb/hsl, named colours)
  2. no raw lengths or durations (px, rem, em, ms, s); 0, %, fr, vw/vh and deg are fine
  3. font-weight and line-height come from --fw-* and --lh-* tokens
  4. never read controls (--ctl-*) or primitives (--p-*) directly
  5. every var(--name) is defined in tokens.css or locally in the same file
  6. inline style attributes may only carry data (custom properties set to % or numbers)
  7. SVG in pages uses currentColor, never a raw colour
  8. pages carry no <style> blocks; styles live in linted .css files

Usage: python3 tools/lint_tokens.py [--json report.json]
Exit status is 1 when anything breaks the contract.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / 'tokens.css'
NAMED = r'\b(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|silver|navy|teal|maroon|olive|lime|aqua|fuchsia)\b'
UNIT = re.compile(r'(?<![\w.-])(-?\d*\.?\d+)(px|rem|em|ms|s)\b')
HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')
FUNC = re.compile(r'\b(rgba?|hsla?)\(')
VAR = re.compile(r'var\(\s*(--[\w-]+)')


def strip_comments(text):
    return re.sub(r'/\*.*?\*/', '', text, flags=re.S)


def declarations(css):
    """Yield (line, property, value) for every declaration in innermost blocks."""
    css = strip_comments(css)
    depth, start, blocks = 0, 0, []
    for i, ch in enumerate(css):
        if ch == '{':
            depth += 1
            start = i + 1
        elif ch == '}':
            seg = css[start:i]
            if '{' not in seg:
                blocks.append((start, seg))
            depth -= 1
            start = i + 1
    for offset, seg in blocks:
        pos = 0
        for part in seg.split(';'):
            if ':' in part:
                prop, value = part.split(':', 1)
                line = css.count('\n', 0, offset + pos) + 1
                yield line, prop.strip(), value.strip()
            pos += len(part) + 1


def defined_tokens(css):
    return set(re.findall(r'(--[\w-]+)\s*:', strip_comments(css)))


def check_value(prop, value, local, tokens):
    problems = []
    if prop.startswith('--') and prop in local and re.fullmatch(r'-?\d*\.?\d+%?', value):
        return problems  # local data custom property
    bare = re.sub(r'var\([^)]*\)', 'VAR', value)
    if HEX.search(bare):
        problems.append('raw colour')
    if FUNC.search(bare):
        problems.append('raw colour function')
    if re.search(NAMED, bare) and prop not in ('content', 'grid-template-areas', 'grid-area'):
        problems.append('named colour')
    if UNIT.search(bare) and prop not in ('content',):
        problems.append('raw length or duration')
    if prop == 'font-weight' and not value.startswith('var(--fw-') and value not in ('inherit',):
        problems.append('font-weight must use --fw-*')
    if prop == 'line-height' and not value.startswith('var(--lh-') and value not in ('inherit', '0'):
        problems.append('line-height must use --lh-*')
    for name in VAR.findall(value):
        if name.startswith('--ctl-') or name.startswith('--p-'):
            problems.append(f'reads {name} directly')
        elif name not in tokens and name not in local:
            problems.append(f'undefined token {name}')
    return problems


def lint_css(path, tokens):
    css = path.read_text()
    local = defined_tokens(css)
    out = []
    for line, prop, value in declarations(css):
        for p in check_value(prop, value, local, tokens):
            out.append({'line': line, 'rule': p, 'decl': f'{prop}: {value}'[:120]})
    return out


def lint_html(path):
    html = path.read_text()
    out = []
    for m in re.finditer(r'style="([^"]*)"', html):
        line = html.count('\n', 0, m.start()) + 1
        for decl in filter(None, (d.strip() for d in m.group(1).split(';'))):
            prop, _, value = decl.partition(':')
            prop, value = prop.strip(), value.strip()
            if not (prop.startswith('--') and re.fullmatch(r'-?\d*\.?\d+%?', value)):
                out.append({'line': line, 'rule': 'inline style is not data', 'decl': decl[:120]})
    for m in re.finditer(r'<style[\s>]', html):
        out.append({'line': html.count('\n', 0, m.start()) + 1, 'rule': 'style block in page', 'decl': '<style>'})
    for m in re.finditer(r'\b(fill|stroke|stop-color)="(#[0-9a-fA-F]{3,8}|rgb[^"]*)"', html):
        line = html.count('\n', 0, m.start()) + 1
        out.append({'line': line, 'rule': 'raw colour in SVG', 'decl': m.group(0)})
    return out


def main():
    tokens = defined_tokens(TOKENS.read_text())
    files = sorted(p for p in ROOT.rglob('*') if p.suffix in ('.css', '.html') and p.name != 'tokens.css' and 'tools' not in p.parts)
    report = {'tokens_defined': len(tokens), 'files': {}, 'violations': 0}
    for f in files:
        v = lint_css(f, tokens) if f.suffix == '.css' else lint_html(f)
        report['files'][str(f.relative_to(ROOT))] = v
        report['violations'] += len(v)
    used = set()
    for f in files:
        used |= set(VAR.findall(f.read_text()))
    report['tokens_used'] = len(used & tokens)
    report['tokens_unused'] = sorted(t for t in tokens - used if not t.startswith(('--ctl-', '--p-')))
    if '--json' in sys.argv:
        Path(sys.argv[sys.argv.index('--json') + 1]).write_text(json.dumps(report, indent=2))
    for name, v in report['files'].items():
        status = 'ok' if not v else f'{len(v)} problem(s)'
        print(f'{status:>14}  {name}')
        for item in v[:12]:
            print(f'{"":>16}line {item["line"]}: {item["rule"]} — {item["decl"]}')
    print(f'\n{report["violations"]} violation(s) · {report["tokens_defined"]} tokens defined · {report["tokens_used"]} used')
    sys.exit(1 if report['violations'] else 0)


if __name__ == '__main__':
    main()
