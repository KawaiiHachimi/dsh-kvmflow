/**
 * Small YAML reader/writer for the KVMFlow workflow subset.
 *
 * KVMFlow deliberately keeps the workflow document in readable block YAML.
 * The parser covers block mappings and sequences, quoted/plain scalars,
 * inline JSON-compatible arrays and maps, and `|` / `>` block scalars. It is
 * not a general YAML 1.2 implementation; workflows use a constrained shape
 * and this reader reports the line that failed instead of guessing.
 */
export class YamlError extends Error {
    line;
    constructor(message, line) {
        super(`YAML line ${line}: ${message}`);
        this.name = 'YamlError';
        this.line = line;
    }
}
function stripComment(text) {
    let quote;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (quote !== undefined) {
            if (char === '\\' && quote === '"') {
                index += 1;
                continue;
            }
            if (char === quote)
                quote = undefined;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
            return text.slice(0, index);
        }
    }
    return text;
}
function isMappingStart(text) {
    const match = /^([^:[\]{},]+?):(?=\s|$)/.exec(text);
    if (match === null)
        return false;
    // A Windows drive or a URL has a colon immediately followed by a
    // non-space character, which the lookahead above already rejects.
    return true;
}
function splitPair(text) {
    const match = /^([^:[\]{},]+?):(?:\s+(.*))?$/.exec(text);
    if (match === null)
        throw new Error(`expected a "key: value" pair, got ${JSON.stringify(text)}`);
    return { key: unquoteKey(match[1].trim()), value: (match[2] ?? '').trim() };
}
function unquoteKey(key) {
    if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) {
        try {
            return JSON.parse(key);
        }
        catch {
            return key.slice(1, -1);
        }
    }
    if (key.length >= 2 && key.startsWith("'") && key.endsWith("'")) {
        return key.slice(1, -1).replaceAll("''", "'");
    }
    return key;
}
function splitTopLevel(text, separator) {
    const parts = [];
    let current = '';
    let depth = 0;
    let quote;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (quote !== undefined) {
            current += char;
            if (char === '\\' && quote === '"') {
                index += 1;
                current += text[index] ?? '';
                continue;
            }
            if (char === quote)
                quote = undefined;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }
        if (char === '[' || char === '{' || char === '(')
            depth += 1;
        if (char === ']' || char === '}' || char === ')')
            depth -= 1;
        if (char === separator && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    parts.push(current);
    return parts;
}
function parseScalar(raw) {
    const text = raw.trim();
    if (text === '' || text === '~' || /^null$/i.test(text))
        return null;
    if (/^(true|yes|on)$/i.test(text))
        return true;
    if (/^(false|no|off)$/i.test(text))
        return false;
    if (text.startsWith('"')) {
        if (!text.endsWith('"'))
            throw new Error(`unterminated double-quoted string ${JSON.stringify(text)}`);
        try {
            return JSON.parse(text);
        }
        catch {
            throw new Error(`invalid double-quoted string ${JSON.stringify(text)}`);
        }
    }
    if (text.startsWith("'")) {
        if (!text.endsWith("'"))
            throw new Error(`unterminated single-quoted string ${JSON.stringify(text)}`);
        return text.slice(1, -1).replaceAll("''", "'");
    }
    if (text.startsWith('[') && text.endsWith(']')) {
        const inner = text.slice(1, -1).trim();
        if (inner === '')
            return [];
        return splitTopLevel(inner, ',').map(part => parseScalar(part));
    }
    if (text.startsWith('{') && text.endsWith('}')) {
        const inner = text.slice(1, -1).trim();
        if (inner === '')
            return {};
        const object = {};
        for (const part of splitTopLevel(inner, ',')) {
            const { key, value } = splitPair(part.trim());
            object[key] = parseScalar(value);
        }
        return object;
    }
    if (/^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(text))
        return Number(text);
    if (text === 'NaN' || text === '.nan')
        return Number.NaN;
    if (text === 'Infinity' || text === '.inf')
        return Number.POSITIVE_INFINITY;
    return text;
}
/**
 * Parse a workflow YAML document.
 * @param text - YAML source.
 * @returns the parsed value.
 */
export function parseYaml(text) {
    const lines = [];
    const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
    for (let index = 0; index < rawLines.length; index += 1) {
        const raw = rawLines[index];
        const trimmed = raw.trim();
        if (trimmed === '' || trimmed === '---' || trimmed === '...')
            continue;
        const indent = raw.length - raw.trimStart().length;
        const content = stripComment(raw.slice(indent)).trimEnd();
        if (content === '')
            continue;
        lines.push({ indent, content, lineNo: index + 1 });
    }
    if (lines.length === 0)
        return null;
    let cursor = 0;
    const peek = () => lines[cursor];
    function parseBlock(indent) {
        const first = peek();
        if (first === undefined || first.indent < indent)
            return null;
        const sequence = first.content === '-' || first.content.startsWith('- ');
        return sequence ? parseSequence(first.indent) : parseMapping(first.indent);
    }
    function parseBlockScalar(header, parentIndent) {
        const folded = header.startsWith('>');
        const parts = [];
        let blockIndent = -1;
        while (cursor < lines.length) {
            const line = lines[cursor];
            if (line.indent <= parentIndent)
                break;
            if (blockIndent < 0)
                blockIndent = line.indent;
            const extra = Math.max(0, line.indent - blockIndent);
            parts.push(`${' '.repeat(extra)}${line.content}`);
            cursor += 1;
        }
        return folded ? parts.join(' ') : parts.join('\n');
    }
    function parseSequence(indent) {
        const result = [];
        while (cursor < lines.length) {
            const line = lines[cursor];
            if (line.indent < indent)
                break;
            if (line.indent > indent)
                throw new YamlError('unexpected indentation inside a sequence', line.lineNo);
            if (!(line.content === '-' || line.content.startsWith('- ')))
                break;
            const rest = line.content.slice(1).trimStart();
            cursor += 1;
            if (rest === '') {
                const next = peek();
                result.push(next !== undefined && next.indent > indent ? parseBlock(next.indent) : null);
                continue;
            }
            if (isMappingStart(rest)) {
                const { key, value } = splitPair(rest);
                const object = {};
                if (value === '') {
                    const next = peek();
                    if (next !== undefined && next.indent > indent) {
                        object[key] = parseBlock(next.indent);
                    }
                    else {
                        object[key] = null;
                    }
                }
                else if (value.startsWith('|') || value.startsWith('>')) {
                    object[key] = parseBlockScalar(value, indent);
                }
                else {
                    object[key] = parseScalar(value);
                }
                // Remaining mapping keys of this item are indented deeper than the dash.
                while (cursor < lines.length) {
                    const next = lines[cursor];
                    if (next.indent <= indent)
                        break;
                    if (next.content === '-' || next.content.startsWith('- '))
                        break;
                    Object.assign(object, parseMapping(next.indent));
                }
                result.push(object);
                continue;
            }
            if (rest.startsWith('[') || rest.startsWith('{')) {
                result.push(parseScalar(rest));
                continue;
            }
            result.push(parseScalar(rest));
        }
        return result;
    }
    function parseMapping(indent) {
        const object = {};
        while (cursor < lines.length) {
            const line = lines[cursor];
            if (line.indent < indent)
                break;
            if (line.indent > indent)
                throw new YamlError('unexpected indentation inside a mapping', line.lineNo);
            if (line.content === '-' || line.content.startsWith('- '))
                break;
            if (!isMappingStart(line.content))
                throw new YamlError(`expected a mapping key, got ${JSON.stringify(line.content)}`, line.lineNo);
            const { key, value } = splitPair(line.content);
            cursor += 1;
            if (value === '') {
                const next = peek();
                if (next !== undefined && next.indent > indent) {
                    object[key] = parseBlock(next.indent);
                }
                else if (next !== undefined && next.indent === indent && (next.content === '-' || next.content.startsWith('- '))) {
                    // YAML permits an indentless block sequence as a mapping value.
                    object[key] = parseSequence(indent);
                }
                else {
                    object[key] = null;
                }
            }
            else if (value.startsWith('|') || value.startsWith('>')) {
                object[key] = parseBlockScalar(value, indent);
            }
            else {
                object[key] = parseScalar(value);
            }
        }
        return object;
    }
    const value = parseBlock(lines[0].indent);
    if (cursor < lines.length) {
        throw new YamlError(`could not reduce ${JSON.stringify(lines[cursor].content)}`, lines[cursor].lineNo);
    }
    return value;
}
function scalarNeedsQuotes(text) {
    if (text === '')
        return true;
    if (/^(?:null|~|true|false|yes|no|on|off)$/i.test(text))
        return true;
    if (/^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(text))
        return true;
    if (/^[.*&!?|>@`%{[\],:#-]/.test(text))
        return true;
    if (/[:#]\s/.test(text) || /[#:]\s*$/.test(text))
        return true;
    if (/[\n\r\t]/.test(text))
        return true;
    return false;
}
function dumpScalar(value) {
    if (value === null)
        return 'null';
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number')
        return Number.isFinite(value) ? String(value) : 'null';
    if (value === '')
        return '""';
    if (scalarNeedsQuotes(value))
        return JSON.stringify(value);
    return value;
}
function dumpInline(value) {
    if (value === null || typeof value !== 'object')
        return dumpScalar(value);
    if (Array.isArray(value))
        return `[${value.map(item => dumpInline(item)).join(', ')}]`;
    const entries = Object.entries(value).filter(([, child]) => child !== undefined);
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}: ${dumpInline(child)}`).join(', ')}}`;
}
function dumpValue(value, indent) {
    const pad = ' '.repeat(indent);
    if (Array.isArray(value)) {
        if (value.length === 0)
            return [`${pad}[]`];
        const lines = [];
        for (const item of value) {
            if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                const entries = Object.entries(item).filter(([, child]) => child !== undefined);
                if (entries.length === 0) {
                    lines.push(`${pad}- {}`);
                    continue;
                }
                const [firstKey, firstValue] = entries[0];
                if (firstValue !== null && typeof firstValue === 'object') {
                    lines.push(`${pad}- ${firstKey}:`);
                    lines.push(...dumpValue(firstValue, indent + 4));
                }
                else if (typeof firstValue === 'string' && firstValue.includes('\n')) {
                    lines.push(`${pad}- ${firstKey}: |`);
                    for (const part of firstValue.split('\n'))
                        lines.push(`${pad}    ${part}`);
                }
                else {
                    lines.push(`${pad}- ${firstKey}: ${dumpScalar(firstValue)}`);
                }
                for (const [key, child] of entries.slice(1)) {
                    if (child !== null && typeof child === 'object') {
                        lines.push(`${pad}  ${key}:`);
                        lines.push(...dumpValue(child, indent + 4));
                    }
                    else if (typeof child === 'string' && child.includes('\n')) {
                        lines.push(`${pad}  ${key}: |`);
                        for (const part of child.split('\n'))
                            lines.push(`${pad}    ${part}`);
                    }
                    else {
                        lines.push(`${pad}  ${key}: ${dumpScalar(child)}`);
                    }
                }
                continue;
            }
            if (Array.isArray(item)) {
                lines.push(`${pad}- ${dumpInline(item)}`);
            }
            else {
                lines.push(`${pad}- ${dumpScalar(item)}`);
            }
        }
        return lines;
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value).filter(([, child]) => child !== undefined);
        if (entries.length === 0)
            return [`${pad}{}`];
        const lines = [];
        for (const [key, child] of entries) {
            if (child !== null && typeof child === 'object') {
                lines.push(`${pad}${key}:`);
                lines.push(...dumpValue(child, indent + 2));
            }
            else if (typeof child === 'string' && child.includes('\n')) {
                lines.push(`${pad}${key}: |`);
                for (const part of child.split('\n'))
                    lines.push(`${pad}  ${part}`);
            }
            else {
                lines.push(`${pad}${key}: ${dumpScalar(child)}`);
            }
        }
        return lines;
    }
    return [`${pad}${dumpScalar(value)}`];
}
/**
 * Serialize a workflow-shaped value as block YAML.
 * @param value - value to serialize.
 * @param header - optional comment lines placed above the document.
 * @returns YAML text ending with a newline.
 */
export function dumpYaml(value, header) {
    const lines = [];
    if (header !== undefined && header !== '') {
        for (const line of header.split('\n'))
            lines.push(`# ${line}`.trimEnd());
    }
    lines.push(...dumpValue(value, 0));
    return `${lines.join('\n')}\n`;
}
