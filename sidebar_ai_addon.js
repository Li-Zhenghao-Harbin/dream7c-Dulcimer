// 侧栏增强脚本：选择本地 ONNX 模型并触发自动填充。
(function () {
    let selectedModel = null;
    let isAutofillCollapsed = false;
    const MODEL_CACHE_KEY = 'aiAutofillSelectedModel';
    const LOG_PREFIX = '[自动填充][侧栏]';
    const log = (...args) => console.log(LOG_PREFIX, ...args);
    const warn = (...args) => console.warn(LOG_PREFIX, ...args);
    const errlog = (...args) => console.error(LOG_PREFIX, ...args);

    function showNotification(message, type = 'info') {
        const old = document.querySelector('.notification');
        if (old) old.remove();
        const n = document.createElement('div');
        n.className = `notification ${type}`;
        n.textContent = message;
        document.body.appendChild(n);
        setTimeout(() => n.parentNode && n.parentNode.removeChild(n), 3000);
    }

    function getDataItemsFromStorage(cb) {
        chrome.storage.local.get(['dataItems'], (result) => {
            if (chrome.runtime.lastError) {
                errlog('读取 dataItems 失败', chrome.runtime.lastError);
                cb([]);
                return;
            }
            const items = Array.isArray(result.dataItems) ? result.dataItems : [];
            log('已读取 dataItems', { count: items.length });
            cb(items);
        });
    }

    function saveModelToSession(model, cb) {
        if (!chrome.storage?.session) {
            cb && cb(false);
            return;
        }
        chrome.storage.session.set({ [MODEL_CACHE_KEY]: model }, () => {
            if (chrome.runtime.lastError) {
                warn('缓存模型到 session 失败', chrome.runtime.lastError);
                cb && cb(false);
                return;
            }
            cb && cb(true);
        });
    }

    function restoreModelFromSession(cb) {
        if (!chrome.storage?.session) {
            cb(null);
            return;
        }
        chrome.storage.session.get([MODEL_CACHE_KEY], (result) => {
            if (chrome.runtime.lastError) {
                warn('从 session 恢复模型失败', chrome.runtime.lastError);
                cb(null);
                return;
            }
            const cached = result && result[MODEL_CACHE_KEY];
            if (!cached || !(cached.bytes instanceof ArrayBuffer) || !cached.name) {
                cb(null);
                return;
            }
            cb(cached);
        });
    }

    function updateModelStatus(statusEl) {
        if (!statusEl) return;
        if (selectedModel && selectedModel.name) {
            statusEl.textContent = `已选模型：${selectedModel.name}`;
            statusEl.title = selectedModel.name;
            statusEl.classList.add('ready');
        } else {
            statusEl.textContent = '未选择模型';
            statusEl.title = '未选择模型';
            statusEl.classList.remove('ready');
        }
    }

    function updateAutofillPanelState(panelEl, toggleBtn) {
        if (!panelEl || !toggleBtn) return;
        panelEl.classList.toggle('collapsed', isAutofillCollapsed);
        toggleBtn.textContent = isAutofillCollapsed ? '▸' : '▾';
        toggleBtn.title = isAutofillCollapsed ? '展开' : '收起';
    }

    function setupButton() {
        const content = document.querySelector('.sidebar-content');
        const dataList = document.getElementById('data-list');
        if (!content || !dataList || document.getElementById('autofill-run-btn')) return;

        const modelInput = document.createElement('input');
        modelInput.type = 'file';
        modelInput.accept = '.onnx,application/octet-stream';
        modelInput.style.display = 'none';
        modelInput.id = 'autofill-model-input';
        document.body.appendChild(modelInput);

        const panel = document.createElement('div');
        panel.className = 'group-panel autofill-panel';

        const head = document.createElement('div');
        head.className = 'group-panel-head';

        const title = document.createElement('div');
        title.className = 'group-panel-title';
        title.textContent = '自动填充';

        const actions = document.createElement('div');
        actions.className = 'group-panel-actions';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'group-head-btn';
        toggleBtn.id = 'toggle-autofill-panel-btn';
        toggleBtn.type = 'button';

        const modelBtn = document.createElement('button');
        modelBtn.className = 'autofill-btn autofill-model-btn';
        modelBtn.id = 'autofill-model-btn';
        modelBtn.title = '选择本地 ONNX 模型';
        modelBtn.textContent = '选择模型';

        const runBtn = document.createElement('button');
        runBtn.className = 'autofill-btn autofill-run-btn';
        runBtn.id = 'autofill-run-btn';
        runBtn.title = '使用已选模型执行自动填充';
        runBtn.textContent = '自动填充';

        const status = document.createElement('div');
        status.className = 'autofill-model-status';

        const body = document.createElement('div');
        body.className = 'group-panel-body autofill-panel-body';
        body.appendChild(modelBtn);
        body.appendChild(runBtn);
        body.appendChild(status);

        actions.appendChild(toggleBtn);
        head.appendChild(title);
        head.appendChild(actions);
        panel.appendChild(head);
        panel.appendChild(body);
        content.insertBefore(panel, dataList);
        updateModelStatus(status);
        updateAutofillPanelState(panel, toggleBtn);
        restoreModelFromSession((cached) => {
            if (!cached) return;
            selectedModel = cached;
            updateModelStatus(status);
            log('已从 session 恢复模型', {
                name: cached.name,
                bytes: cached.bytes.byteLength
            });
        });

        toggleBtn.addEventListener('click', () => {
            isAutofillCollapsed = !isAutofillCollapsed;
            updateAutofillPanelState(panel, toggleBtn);
        });

        modelBtn.addEventListener('click', () => {
            log('点击选择模型按钮');
            modelInput.click();
        });

        modelInput.addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) {
                warn('已取消选择模型');
                return;
            }
            try {
                const buffer = await file.arrayBuffer();
                selectedModel = { name: file.name, bytes: buffer };
                updateModelStatus(status);
                log('模型加载完成', { name: file.name, bytes: buffer.byteLength });
                saveModelToSession(selectedModel, (ok) => {
                    if (ok) {
                        log('模型已缓存到 session', { name: file.name });
                    }
                });
                showNotification(`模型已加载：${file.name}`, 'success');
            } catch (err) {
                errlog('读取模型文件失败', err);
                selectedModel = null;
                updateModelStatus(status);
                showNotification('模型文件加载失败', 'error');
            }
        });

        runBtn.addEventListener('click', () => {
            log('点击自动填充');
            if (!selectedModel || !selectedModel.bytes) {
                warn('已阻止填充：未选择模型');
                showNotification('请先选择 ONNX 模型', 'error');
                return;
            }

            getDataItemsFromStorage((dataItems) => {
                if (!dataItems.length) {
                    warn('已阻止填充：没有可用数据');
                    showNotification('没有可用的数据项', 'error');
                    return;
                }

                log('向页面发送填充请求', {
                    modelName: selectedModel.name,
                    modelBytes: selectedModel.bytes.byteLength,
                    dataItemCount: dataItems.length
                });

                window.parent.postMessage({
                    type: 'DATA_FILLER_AI_FILL_ALL',
                    dataItems,
                    modelName: selectedModel.name,
                    modelBuffer: selectedModel.bytes
                }, '*');

                showNotification(`正在执行自动填充：${selectedModel.name}`, 'info');
            });
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        const data = event.data;
        if (!data || data.type !== 'DATA_FILLER_AI_FILL_RESULT') return;

        log('收到填充结果', data);
        if (data.success) {
            showNotification(`自动填充完成：已填充 ${data.filledCount || 0} 项`, 'success');
        } else {
            showNotification(`自动填充失败：${data.message || '未知错误'}`, 'error');
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupButton);
    } else {
        setupButton();
    }
})();

