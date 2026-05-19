// AI 填充脚本：接收本地 ONNX 模型并执行页面字段推理填充。
(function () {
    const modelSessionCache = new Map();
    let runtimeConfigured = false;
    const LOG_PREFIX = '[AI填充][页面]';
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

    function normalizeKey(text) {
        return String(text || '').trim().toLowerCase().replace(/\s+/g, '');
    }

    function fieldExactKeys(input) {
        return [
            getLabelText(input),
            input.placeholder || '',
            input.name || '',
            input.id || '',
            input.getAttribute ? (input.getAttribute('aria-label') || '') : ''
        ]
            .map(normalizeKey)
            .filter(Boolean);
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
            log('复用已缓存 ONNX 会话', { key });
            return modelSessionCache.get(key);
        }
        if (!globalThis.ort || !ort.InferenceSession) {
            throw new Error('onnx_runtime_missing');
        }
        if (!runtimeConfigured && globalThis.chrome?.runtime?.getURL && ort.env?.wasm) {
            ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/onnxruntime-web/');
            ort.env.wasm.proxy = false;
            runtimeConfigured = true;
            log('已配置 wasmPaths', ort.env.wasm.wasmPaths);
        }
        log('开始创建 ONNX 会话', { modelName, bytes: modelBuffer.byteLength });
        const session = await ort.InferenceSession.create(modelBuffer, {
            executionProviders: ['wasm']
        });
        modelSessionCache.set(key, session);
        log('ONNX 会话创建成功', { key });
        return session;
    }

    function readLogits(outputTensor) {
        const data = outputTensor.data;
        const dims = outputTensor.dims || [];
        if (dims.length !== 2) return null;
        return { data, rows: dims[0], cols: dims[1] };
    }

    function softmax(row) {
        let max = -Infinity;
        for (const v of row) max = Math.max(max, v);
        const exps = row.map(v => Math.exp(v - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        return exps.map(v => v / (sum || 1));
    }

    function matchWithConfidence(logits, numFields, numEntries, threshold) {
        const candidates = [];
        for (let f = 0; f < numFields; f++) {
            const row = [];
            for (let e = 0; e < numEntries; e++) {
                row.push(logits[f * numEntries + e]);
            }
            const probs = softmax(row);
            let bestEntry = 0;
            let bestProb = probs[0] || 0;
            for (let e = 1; e < probs.length; e++) {
                if (probs[e] > bestProb) {
                    bestProb = probs[e];
                    bestEntry = e;
                }
            }
            candidates.push({ fieldIdx: f, entryIdx: bestEntry, confidence: bestProb });
        }

        candidates.sort((a, b) => b.confidence - a.confidence);
        const usedFields = new Set();
        const usedEntries = new Set();
        const pairs = [];
        for (const c of candidates) {
            if (c.confidence < threshold) continue;
            if (usedFields.has(c.fieldIdx) || usedEntries.has(c.entryIdx)) continue;
            usedFields.add(c.fieldIdx);
            usedEntries.add(c.entryIdx);
            pairs.push(c);
        }
        return pairs;
    }

    async function aiFillWithOnnx(payload) {
        const dataItems = payload.dataItems;
        const modelBuffer = payload.modelBuffer;
        const modelName = payload.modelName || 'model.onnx';
        const confidenceThreshold = typeof payload.confidenceThreshold === 'number'
            ? Math.max(0, Math.min(1, payload.confidenceThreshold))
            : 0.25;
        const t0 = Date.now();
        log('开始处理填充请求', {
            modelName,
            hasModelBuffer: modelBuffer instanceof ArrayBuffer,
            dataItemCount: Array.isArray(dataItems) ? dataItems.length : 0,
            confidenceThreshold
        });

        if (!Array.isArray(dataItems) || dataItems.length === 0) {
            warn('中止：没有数据项');
            return { success: false, message: '没有数据项', filledCount: 0 };
        }
        if (!(modelBuffer instanceof ArrayBuffer)) {
            warn('中止：模型数据缺失');
            return { success: false, message: '未选择模型', filledCount: 0 };
        }

        const fields = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).filter(isFillableInput);
        const emptyFields = fields.filter(f => f.isContentEditable || !String(f.value || '').trim());
        log('字段扫描结果', {
            allFillableFields: fields.length,
            emptyFields: emptyFields.length
        });
        if (!emptyFields.length) {
            warn('中止：没有可填充的空字段');
            return { success: false, message: '没有可填充的空字段', filledCount: 0 };
        }

        const fieldRows = emptyFields.map(fieldText);
        const entryRows = dataItems.map(entryText);
        const itemNameKeys = dataItems.map(item => normalizeKey(item?.name || ''));

        // 规则优先：字段 key 与数据 name 完全一致时直接填充，避免模型误配。
        const prefilledFieldSet = new Set();
        const usedItemSet = new Set();
        let ruleFilledCount = 0;
        for (let fi = 0; fi < emptyFields.length; fi++) {
            const field = emptyFields[fi];
            const keys = fieldExactKeys(field);
            if (!keys.length) continue;

            let matchedItemIdx = -1;
            for (let ei = 0; ei < itemNameKeys.length; ei++) {
                if (usedItemSet.has(ei)) continue;
                const nameKey = itemNameKeys[ei];
                if (nameKey && keys.includes(nameKey)) {
                    matchedItemIdx = ei;
                    break;
                }
            }

            if (matchedItemIdx >= 0) {
                const ok = setInputValue(field, String(dataItems[matchedItemIdx].value || ''));
                log('规则精确匹配命中', {
                    fieldIdx: fi,
                    entryIdx: matchedItemIdx,
                    entryName: dataItems[matchedItemIdx].name,
                    ok
                });
                if (ok) {
                    prefilledFieldSet.add(fi);
                    usedItemSet.add(matchedItemIdx);
                    ruleFilledCount += 1;
                }
            }
        }

        const seqLen = 16;
        const vocabSize = 4096;

        let session;
        try {
            session = await getSession(modelName, modelBuffer);
        } catch (e) {
            errlog('创建 ONNX 会话失败', e);
            return { success: false, message: `创建会话失败: ${String(e.message || e)}`, filledCount: 0 };
        }

        const remainFieldIdx = [];
        for (let i = 0; i < fieldRows.length; i++) {
            if (!prefilledFieldSet.has(i)) remainFieldIdx.push(i);
        }
        const remainEntryIdx = [];
        for (let i = 0; i < entryRows.length; i++) {
            if (!usedItemSet.has(i)) remainEntryIdx.push(i);
        }

        if (remainFieldIdx.length === 0 || remainEntryIdx.length === 0) {
            const result = {
                success: ruleFilledCount > 0,
                message: ruleFilledCount > 0 ? '完成' : '未达到阈值或无匹配',
                filledCount: ruleFilledCount
            };
            log('仅规则匹配完成，无需模型推理', result);
            return result;
        }

        const remainFieldRows = remainFieldIdx.map(i => fieldRows[i]);
        const remainEntryRows = remainEntryIdx.map(i => entryRows[i]);
        const fieldIds = buildTensor2D(remainFieldRows, seqLen, vocabSize);
        const entryIds = buildTensor2D(remainEntryRows, seqLen, vocabSize);

        const feeds = {
            field_token_ids: new ort.Tensor('int64', fieldIds, [remainFieldRows.length, seqLen]),
            entry_token_ids: new ort.Tensor('int64', entryIds, [remainEntryRows.length, seqLen])
        };

        let output;
        try {
            log('开始推理', {
                fieldShape: [remainFieldRows.length, seqLen],
                entryShape: [remainEntryRows.length, seqLen]
            });
            output = await session.run(feeds);
        } catch (e) {
            errlog('推理失败', e);
            return { success: false, message: `推理失败: ${String(e.message || e)}`, filledCount: 0 };
        }

        const first = output.logits || output[Object.keys(output)[0]];
        if (!first) return { success: false, message: '模型输出缺少 logits', filledCount: 0 };
        const parsed = readLogits(first);
        if (!parsed) {
            warn('logits 形状无效', first.dims);
            return { success: false, message: 'logits 形状无效', filledCount: 0 };
        }
        log('推理输出', { logitsShape: [parsed.rows, parsed.cols] });

        const pairs = matchWithConfidence(parsed.data, parsed.rows, parsed.cols, confidenceThreshold);
        log('置信度过滤后匹配数', { pairCount: pairs.length, confidenceThreshold });
        let modelFilledCount = 0;
        for (const p of pairs) {
            const originFieldIdx = remainFieldIdx[p.fieldIdx];
            const originEntryIdx = remainEntryIdx[p.entryIdx];
            const field = emptyFields[originFieldIdx];
            const item = dataItems[originEntryIdx];
            if (!field || !item) continue;
            const ok = setInputValue(field, String(item.value || ''));
            log('填充尝试', {
                fieldIdx: originFieldIdx,
                entryIdx: originEntryIdx,
                entryName: item.name,
                confidence: p.confidence,
                ok
            });
            if (ok) modelFilledCount += 1;
        }

        const filledCount = ruleFilledCount + modelFilledCount;
        const result = { success: filledCount > 0, message: filledCount > 0 ? '完成' : '未达到阈值或无匹配', filledCount };
        log('填充完成', { ...result, elapsedMs: Date.now() - t0 });
        return result;
    }

    window.addEventListener('message', async (event) => {
        const data = event.data;
        if (!data || data.type !== 'DATA_FILLER_AI_FILL_ALL') return;
        log('收到填充消息');

        const result = await aiFillWithOnnx(data);
        log('回传填充结果', result);
        event.source?.postMessage({
            type: 'DATA_FILLER_AI_FILL_RESULT',
            success: result.success,
            message: result.message,
            filledCount: result.filledCount
        }, '*');
    });
})();
