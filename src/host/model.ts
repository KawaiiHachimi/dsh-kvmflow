/** DSH-model-backed visual verification for recorded screenshots. */

export interface VisionVerdict {
  passed: boolean;
  reason: string;
  raw: string;
}

export interface VisionRequest {
  data: Uint8Array;
  condition: string;
  context?: string;
  signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVerdict(text: string): VisionVerdict {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '');
  let verdict: boolean | undefined;
  let reason = '';
  for (const line of lines) {
    const match = /^(?:VERDICT\s*[:：]\s*)?(PASS|FAIL|通过|失败)\b/i.exec(line);
    if (match !== null) {
      verdict = /^(?:PASS|通过)$/i.test(match[1]) ? true : false;
      const remainder = line.slice(match[0].length).replace(/^[\s:：-]+/, '').trim();
      if (remainder !== '') reason = remainder;
      continue;
    }
    if (reason === '' && !/^(PASS|FAIL|通过|失败)$/i.test(line)) reason = line;
  }
  if (verdict === undefined) {
    const upper = text.toUpperCase();
    if (upper.includes('FAIL') || text.includes('失败')) verdict = false;
    else if (upper.includes('PASS') || text.includes('通过')) verdict = true;
  }
  if (verdict === undefined) {
    return { passed: false, reason: `Vision model did not return PASS/FAIL: ${text.slice(0, 300)}`, raw: text };
  }
  return { passed: verdict, reason: reason.slice(0, 500), raw: text };
}

/**
 * Ask the default DSH model to judge one screenshot against a condition.
 * @param ctx - Host context carrying `llm`, `attachments`, and `agentDefaultModel`.
 * @param request - image bytes and the success condition.
 * @returns the parsed verdict.
 */
export async function verifyWithVision(ctx: any, request: VisionRequest): Promise<VisionVerdict> {
  const llm = ctx.get('llm');
  const attachments = ctx.get('attachments');
  const defaults = ctx.get('agentDefaultModel');
  if (llm === undefined || typeof llm.stream !== 'function') {
    throw new Error('vision verification is unavailable: no LLM service is mounted');
  }
  if (attachments === undefined || typeof attachments.saveImage !== 'function') {
    throw new Error('vision verification is unavailable: no attachment service is mounted');
  }
  const selection = defaults?.currentSelection?.();
  if (!isRecord(selection) || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
    throw new Error('vision verification is unavailable: no default model is selected');
  }
  const attachment = await attachments.saveImage({
    data: request.data,
    mediaType: 'image/jpeg',
    name: 'kvmflow-verify.jpg',
  });
  const prompt = [
    'You are a strict KVM screen verifier. Decide whether the attached screenshot satisfies the success condition.',
    'Answer on the first line with exactly PASS or FAIL. On the second line give one short reason.',
    'If a required element is partially visible but clearly present, PASS. If the screen is still loading, shows an error, or lacks the required element, FAIL.',
    '',
    `Success condition: ${request.condition}`,
    ...(request.context === undefined || request.context === '' ? [] : ['', `Step context: ${request.context}`]),
  ].join('\n');
  const chunks = llm.stream({
    provider: selection.provider,
    model: selection.model,
    ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image', attachment },
      ],
    }],
    temperature: 0,
    maxTokens: 400,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
  let text = '';
  let failure: string | undefined;
  for await (const chunk of chunks) {
    if (!isRecord(chunk)) continue;
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
    if (chunk.type === 'finish' && isRecord(chunk.reason)) {
      if (chunk.reason.kind === 'error' && isRecord(chunk.reason.failure)) {
        failure = typeof chunk.reason.failure.message === 'string' ? chunk.reason.failure.message : 'model call failed';
      }
      if (chunk.reason.kind === 'aborted') failure = 'model call aborted';
      if (chunk.reason.kind === 'max-tokens') failure = 'model reply hit the token limit';
    }
  }
  if (failure !== undefined) throw new Error(`vision verification failed: ${failure}`);
  if (text.trim() === '') throw new Error('vision verification returned an empty reply');
  return parseVerdict(text);
}
