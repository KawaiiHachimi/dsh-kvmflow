/** DSH-model-backed visual verification and model discovery for KVMFlow. */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseVerdict(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '');
    let verdict;
    let reason = '';
    for (const line of lines) {
        const match = /^(?:VERDICT\s*[:：]\s*)?(PASS|FAIL|通过|失败)\b/i.exec(line);
        if (match !== null) {
            verdict = /^(?:PASS|通过)$/i.test(match[1]) ? true : false;
            const remainder = line.slice(match[0].length).replace(/^[\s:：-]+/, '').trim();
            if (remainder !== '')
                reason = remainder;
            continue;
        }
        if (reason === '' && !/^(PASS|FAIL|通过|失败)$/i.test(line))
            reason = line;
    }
    if (verdict === undefined) {
        const upper = text.toUpperCase();
        if (upper.includes('FAIL') || text.includes('失败'))
            verdict = false;
        else if (upper.includes('PASS') || text.includes('通过'))
            verdict = true;
    }
    if (verdict === undefined) {
        return { passed: false, reason: `Vision model did not return PASS/FAIL: ${text.slice(0, 300)}`, raw: text };
    }
    return { passed: verdict, reason: reason.slice(0, 500), raw: text };
}
/**
 * List every model registered in DSH across active LLM providers, alongside
 * DSH's current default selection.
 */
export async function listAvailableModels(ctx) {
    const llm = ctx.get('llm');
    const defaults = ctx.get('agentDefaultModel');
    const selection = defaults?.currentSelection?.();
    const defaultModel = isRecord(selection) && typeof selection.provider === 'string' && typeof selection.model === 'string'
        ? {
            provider: selection.provider,
            model: selection.model,
            ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}),
        }
        : undefined;
    const models = [];
    if (llm !== undefined && typeof llm.listProviders === 'function' && typeof llm.listModels === 'function') {
        let providers = [];
        try {
            providers = llm.listProviders() ?? [];
        }
        catch {
            providers = [];
        }
        for (const provider of providers) {
            if (!isRecord(provider) || typeof provider.id !== 'string')
                continue;
            const providerName = typeof provider.name === 'string' && provider.name !== '' ? provider.name : provider.id;
            try {
                const list = await llm.listModels(provider.id);
                if (!Array.isArray(list))
                    continue;
                for (const entry of list) {
                    if (!isRecord(entry) || typeof entry.id !== 'string')
                        continue;
                    const modalities = Array.isArray(entry.inputModalities) ? entry.inputModalities : undefined;
                    models.push({
                        provider: provider.id,
                        providerName,
                        id: entry.id,
                        name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.id,
                        supportsImage: modalities === undefined ? true : modalities.includes('image'),
                    });
                }
            }
            catch {
                // Ignore a provider whose catalog fails to enumerate.
            }
        }
    }
    return { models, ...(defaultModel === undefined ? {} : { defaultModel }) };
}
/**
 * Send one screenshot and one instruction to the chosen (or default) DSH model.
 * @param ctx - Host context carrying `llm`, `attachments`, and `agentDefaultModel`.
 * @param request - image bytes, the full instruction, optional model override, and a token budget.
 * @returns the model's reply text.
 */
export async function askVision(ctx, request) {
    const llm = ctx.get('llm');
    const attachments = ctx.get('attachments');
    const defaults = ctx.get('agentDefaultModel');
    if (llm === undefined || typeof llm.stream !== 'function') {
        throw new Error('vision is unavailable: no LLM service is mounted');
    }
    if (attachments === undefined || typeof attachments.saveImage !== 'function') {
        throw new Error('vision is unavailable: no attachment service is mounted');
    }
    const override = request.model !== undefined && request.model.provider !== '' && request.model.model !== '' ? request.model : undefined;
    const selection = override ?? defaults?.currentSelection?.();
    if (!isRecord(selection) || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
        throw new Error('vision is unavailable: no default model is selected');
    }
    const attachment = await attachments.saveImage({
        data: request.data,
        mediaType: 'image/jpeg',
        name: 'kvmflow-screen.jpg',
    });
    const chunks = llm.stream({
        provider: selection.provider,
        model: selection.model,
        ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}),
        messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: request.prompt },
                    { type: 'image', attachment },
                ],
            }],
        temperature: 0,
        maxTokens: request.maxTokens ?? 400,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    let text = '';
    let failure;
    for await (const chunk of chunks) {
        if (!isRecord(chunk))
            continue;
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string')
            text += chunk.text;
        if (chunk.type === 'finish' && isRecord(chunk.reason)) {
            if (chunk.reason.kind === 'error' && isRecord(chunk.reason.failure)) {
                failure = typeof chunk.reason.failure.message === 'string' ? chunk.reason.failure.message : 'model call failed';
            }
            if (chunk.reason.kind === 'aborted')
                failure = 'model call aborted';
            if (chunk.reason.kind === 'max-tokens' && text.trim() === '')
                failure = 'model reply hit the token limit';
        }
    }
    if (failure !== undefined)
        throw new Error(`vision call failed: ${failure}`);
    if (text.trim() === '')
        throw new Error('vision call returned an empty reply');
    return text;
}
/**
 * Ask the default DSH model to judge one screenshot against a condition.
 * @param ctx - Host context carrying `llm`, `attachments`, and `agentDefaultModel`.
 * @param request - image bytes and the success condition.
 * @returns the parsed verdict.
 */
export async function verifyWithVision(ctx, request) {
    const prompt = [
        'You are a strict KVM screen verifier. Decide whether the attached screenshot satisfies the success condition.',
        'Answer on the first line with exactly PASS or FAIL. On the second line give one short reason.',
        'If a required element is partially visible but clearly present, PASS. If the screen is still loading, shows an error, or lacks the required element, FAIL.',
        '',
        `Success condition: ${request.condition}`,
        ...(request.context === undefined || request.context === '' ? [] : ['', `Step context: ${request.context}`]),
    ].join('\n');
    const text = await askVision(ctx, { data: request.data, prompt, maxTokens: 400, ...(request.model === undefined ? {} : { model: request.model }), ...(request.signal === undefined ? {} : { signal: request.signal }) });
    return parseVerdict(text);
}
/** First JSON object in a reply, tolerating code fences and surrounding prose. */
export function parseJsonObject(text) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const body = fenced === null ? text : fenced[1];
    const start = body.indexOf('{');
    if (start < 0)
        return undefined;
    let depth = 0;
    let quote = false;
    for (let index = start; index < body.length; index += 1) {
        const char = body[index];
        if (quote) {
            if (char === '\\')
                index += 1;
            else if (char === '"')
                quote = false;
            continue;
        }
        if (char === '"')
            quote = true;
        else if (char === '{')
            depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                try {
                    const value = JSON.parse(body.slice(start, index + 1));
                    return isRecord(value) ? value : undefined;
                }
                catch {
                    return undefined;
                }
            }
        }
    }
    return undefined;
}
/**
 * Pick one label for a screenshot.
 * @param ctx - Host context.
 * @param request - image, labels (name → description) and extra guidance.
 * @returns the chosen label, or `unknown` when the reply names none of them.
 */
export async function classifyWithVision(ctx, request) {
    const names = Object.keys(request.labels);
    const prompt = [
        'You classify a screenshot of a computer screen captured through an IP-KVM.',
        'Choose the single label whose description matches the screen. If none matches, choose "unknown".',
        'Reply with only a JSON object: {"label": "<one label name>", "reason": "<one short sentence>"}.',
        '',
        ...(request.prompt === undefined || request.prompt === '' ? [] : [`Guidance: ${request.prompt}`, '']),
        'Labels:',
        ...names.map(name => `- ${name}: ${request.labels[name]}`),
        '- unknown: none of the above',
    ].join('\n');
    const raw = await askVision(ctx, { data: request.data, prompt, maxTokens: 300, ...(request.model === undefined ? {} : { model: request.model }), ...(request.signal === undefined ? {} : { signal: request.signal }) });
    const parsed = parseJsonObject(raw);
    let label = typeof parsed?.label === 'string' ? parsed.label.trim() : '';
    if (!names.includes(label)) {
        // A model that answers in prose usually still names the label verbatim.
        const mentioned = names.filter(name => new RegExp(`\\b${name.replace(/[-]/g, '\\-')}\\b`).test(raw));
        label = mentioned.length === 1 ? mentioned[0] : 'unknown';
    }
    const reason = typeof parsed?.reason === 'string' ? parsed.reason : raw.slice(0, 300);
    return { label, reason: reason.slice(0, 500), raw };
}
/**
 * Read named fields off a screenshot.
 * @param ctx - Host context.
 * @param request - image, field names and instructions.
 * @returns the values the model returned for the requested fields.
 */
export async function extractWithVision(ctx, request) {
    const prompt = [
        'You read information off a screenshot of a computer screen captured through an IP-KVM.',
        `Instructions: ${request.prompt}`,
        `Reply with only a JSON object with exactly these keys: ${request.fields.map(field => JSON.stringify(field)).join(', ')}.`,
        'Use null for a value that is not visible. Copy text exactly as shown.',
    ].join('\n');
    const raw = await askVision(ctx, { data: request.data, prompt, maxTokens: 600, ...(request.model === undefined ? {} : { model: request.model }), ...(request.signal === undefined ? {} : { signal: request.signal }) });
    const parsed = parseJsonObject(raw);
    if (parsed === undefined)
        throw new Error(`vision extract did not return JSON: ${raw.slice(0, 200)}`);
    const values = {};
    for (const field of request.fields)
        values[field] = parsed[field] ?? null;
    return { values, raw };
}
/**
 * Find one element on a screenshot.
 * @param ctx - Host context.
 * @param request - image and the element to find.
 * @returns frame-normalized coordinates of the element's centre, when found.
 */
export async function locateWithVision(ctx, request) {
    const prompt = [
        'You locate a UI element on a screenshot of a computer screen captured through an IP-KVM.',
        `Element: ${request.target}`,
        ...(request.context === undefined || request.context === '' ? [] : [`Context: ${request.context}`]),
        'Coordinates are fractions of the image: x from 0 (left edge) to 1 (right edge), y from 0 (top edge) to 1 (bottom edge).',
        'Reply with only a JSON object: {"found": true|false, "x": <number>, "y": <number>, "reason": "<one short sentence>"} giving the centre of the element.',
    ].join('\n');
    const raw = await askVision(ctx, { data: request.data, prompt, maxTokens: 300, ...(request.model === undefined ? {} : { model: request.model }), ...(request.signal === undefined ? {} : { signal: request.signal }) });
    const parsed = parseJsonObject(raw);
    const reason = typeof parsed?.reason === 'string' ? parsed.reason.slice(0, 500) : raw.slice(0, 300);
    if (parsed === undefined || parsed.found !== true)
        return { found: false, reason, raw };
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        return { found: false, reason: `model returned coordinates outside the image: ${JSON.stringify({ x: parsed.x, y: parsed.y })}`, raw };
    }
    return { found: true, x, y, reason, raw };
}
