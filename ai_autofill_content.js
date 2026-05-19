// AI autofill script: receives local ONNX model bytes and fills page fields via ONNX inference.
(function () {
    const modelSessionCache = new Map();
    let runtimeConfigured = false;
    const LOG_PREFIX = '[AI-FILL][CONTENT]';
    const log = (...args) => console.log(LOG_PREFIX, ...args);
    const warn = (...args) => console.warn(LOG_PREFIX, ...args);
    const errlog = (...args) => console.error(LOG_PREFIX, ...args);

    function isInputElement(element) {
        if (!element || !element.tagName) return false;
        const tag = element.tagName.toLowerCase();
        return (tag === 'input' && element.type !== 'hidden') || tag === 'textarea' || element.isContentEditable;
    }

    function isFillableInput(element) {
        if (!isInputElement(element)) return false;
        if (element.disabled || element.readOnly) return false;
        if (element.tagName.toLowerCase() === 'input') {
            const type = String(element.type || '').toLowerCase();
            if (['hidden', 'button', 'submit', 'reset', 'file', 'checkbox', 'radio'].includes(type)) return false;
        }
        return true;
    }

    function setInputValue(input, value) {
        try {
            if (input.isContentEditable) {
                input.textContent = value;
            } else {
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        } catch {
            return false;
        }
    }

    function getLabelText(input) {
        if (!input.id) return '';
        const label = document.querySelector(`label[for="${input.id}"]`);
        return label ? (label.innerText || label.textContent || '').trim() : '';
    }

    function fieldText(input) {
        return [
            getLabelText(input),
            input.placeholder || '',
            input.name || '',
            input.id || '',
            input.getAttribute ? (input.getAttribute('aria-label') || '') : '',
            input.type || ''
        ].filter(Boolean).join(' ');
    }

    function entryText(item) {
        return `${item.name || ''} ${item.value || ''}`;
    }

    function hashToken(token, vocabSize) {
        let h = 2166136261;
        for (let i = 0; i < token.length; i++) {
            h ^= token.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return Math.abs(h >>> 0) % vocabSize;
    }

    function tokenize(text, seqLen, vocabSize) {
        const tokens = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
        const ids = new Array(seqLen).fill(0);
        for (let i = 0; i < Math.min(tokens.length, seqLen); i++) {
            ids[i] = hashToken(tokens[i], vocabSize);
        }
        return ids;
    }

    function buildTensor2D(rows, seqLen, vocabSize) {
        const flat = new BigInt64Array(rows.length * seqLen);
        for (let r = 0; r < rows.length; r++) {
            const ids = tokenize(rows[r], seqLen, vocabSize);
            for (let c = 0; c < seqLen; c++) {
                flat[r * seqLen + c] = BigInt(ids[c]);
            }
        }
        return flat;
    }

    async function getSession(modelName, modelBuffer) {
        const key = `${modelName || 'model'}:${modelBuffer.byteLength}`;
        if (modelSessionCache.has(key)) {
            log('reusing cached ONNX session', { key });
            return modelSessionCache.get(key);
        }
        if (!globalThis.ort || !ort.InferenceSession) {
            throw new Error('onnx_runtime_missing');
        }
        if (!runtimeConfigured && globalThis.chrome?.runtime?.getURL && ort.env?.wasm) {
            ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/onnxruntime-web/');
            ort.env.wasm.proxy = false;
            runtimeConfigured = true;
            log('configured wasmPaths', ort.env.wasm.wasmPaths);
        }
        log('creating ONNX session', { modelName, bytes: modelBuffer.byteLength });
        const session = await ort.InferenceSession.create(modelBuffer, {
            executionProviders: ['wasm']
        });
        modelSessionCache.set(key, session);
        log('created ONNX session', { key });
        return session;
    }

    function readLogits(outputTensor) {
        const data = outputTensor.data;
        const dims = outputTensor.dims || [];
        if (dims.length !== 2) return null;
        return { data, rows: dims[0], cols: dims[1] };
    }

    function greedyMatch(logits, numFields, numEntries) {
        const triples = [];
        for (let f = 0; f < numFields; f++) {
            for (let e = 0; e < numEntries; e++) {
                triples.push({ f, e, s: logits[f * numEntries + e] });
            }
        }
        triples.sort((a, b) => b.s - a.s);
        const usedF = new Set();
        const usedE = new Set();
        const pairs = [];
        for (const t of triples) {
            if (usedF.has(t.f) || usedE.has(t.e)) continue;
            usedF.add(t.f);
            usedE.add(t.e);
            pairs.push({ fieldIdx: t.f, entryIdx: t.e });
        }
        return pairs;
    }

    async function aiFillWithOnnx(payload) {
        const dataItems = payload.dataItems;
        const modelBuffer = payload.modelBuffer;
        const modelName = payload.modelName || 'model.onnx';
        const t0 = Date.now();
        log('start fill request', {
            modelName,
            hasModelBuffer: modelBuffer instanceof ArrayBuffer,
            dataItemCount: Array.isArray(dataItems) ? dataItems.length : 0
        });

        if (!Array.isArray(dataItems) || dataItems.length === 0) {
            warn('abort: no data items');
            return { success: false, message: 'no_data', filledCount: 0 };
        }
        if (!(modelBuffer instanceof ArrayBuffer)) {
            warn('abort: model buffer missing');
            return { success: false, message: 'model_not_selected', filledCount: 0 };
        }

        const fields = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).filter(isFillableInput);
        const emptyFields = fields.filter(f => f.isContentEditable || !String(f.value || '').trim());
        log('field scan', {
            allFillableFields: fields.length,
            emptyFields: emptyFields.length
        });
        if (!emptyFields.length) {
            warn('abort: no empty fields');
            return { success: false, message: 'no_empty_fields', filledCount: 0 };
        }

        const fieldRows = emptyFields.map(fieldText);
        const entryRows = dataItems.map(entryText);

        const seqLen = 16;
        const vocabSize = 4096;

        let session;
        try {
            session = await getSession(modelName, modelBuffer);
        } catch (e) {
            errlog('session create failed', e);
            return { success: false, message: String(e.message || e), filledCount: 0 };
        }

        const fieldIds = buildTensor2D(fieldRows, seqLen, vocabSize);
        const entryIds = buildTensor2D(entryRows, seqLen, vocabSize);

        const feeds = {
            field_token_ids: new ort.Tensor('int64', fieldIds, [fieldRows.length, seqLen]),
            entry_token_ids: new ort.Tensor('int64', entryIds, [entryRows.length, seqLen])
        };

        let output;
        try {
            log('running inference', {
                fieldShape: [fieldRows.length, seqLen],
                entryShape: [entryRows.length, seqLen]
            });
            output = await session.run(feeds);
        } catch (e) {
            errlog('inference failed', e);
            return { success: false, message: `inference_failed:${String(e.message || e)}`, filledCount: 0 };
        }

        const first = output.logits || output[Object.keys(output)[0]];
        if (!first) return { success: false, message: 'missing_logits', filledCount: 0 };
        const parsed = readLogits(first);
        if (!parsed) {
            warn('invalid logits shape', first.dims);
            return { success: false, message: 'invalid_logits_shape', filledCount: 0 };
        }
        log('inference output', { logitsShape: [parsed.rows, parsed.cols] });

        const pairs = greedyMatch(parsed.data, parsed.rows, parsed.cols);
        log('greedy pairs generated', { pairCount: pairs.length });
        let filledCount = 0;
        for (const p of pairs) {
            const field = emptyFields[p.fieldIdx];
            const item = dataItems[p.entryIdx];
            if (!field || !item) continue;
            const ok = setInputValue(field, String(item.value || ''));
            log('fill attempt', {
                fieldIdx: p.fieldIdx,
                entryIdx: p.entryIdx,
                entryName: item.name,
                ok
            });
            if (ok) filledCount += 1;
        }

        const result = { success: filledCount > 0, message: filledCount > 0 ? 'ok' : 'no_match', filledCount };
        log('fill completed', { ...result, elapsedMs: Date.now() - t0 });
        return result;
    }

    window.addEventListener('message', async (event) => {
        const data = event.data;
        if (!data || data.type !== 'DATA_FILLER_AI_FILL_ALL') return;
        log('received fill message');

        const result = await aiFillWithOnnx(data);
        log('posting fill result', result);
        event.source?.postMessage({
            type: 'DATA_FILLER_AI_FILL_RESULT',
            success: result.success,
            message: result.message,
            filledCount: result.filledCount
        }, '*');
    });
})();
