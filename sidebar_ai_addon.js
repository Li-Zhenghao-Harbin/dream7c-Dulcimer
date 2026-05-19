// Sidebar enhancer script: select local ONNX model and trigger AI fill.
(function () {
    let selectedModel = null;
    const LOG_PREFIX = '[AI-FILL][SIDEBAR]';
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
                errlog('failed to read dataItems from storage', chrome.runtime.lastError);
                cb([]);
                return;
            }
            log('loaded dataItems from storage', { count: Array.isArray(result.dataItems) ? result.dataItems.length : 0 });
            cb(Array.isArray(result.dataItems) ? result.dataItems : []);
        });
    }

    function setupButton() {
        const container = document.querySelector('.sidebar-buttons');
        if (!container || document.getElementById('ai-fill-btn')) return;

        const modelInput = document.createElement('input');
        modelInput.type = 'file';
        modelInput.accept = '.onnx,application/octet-stream';
        modelInput.style.display = 'none';
        modelInput.id = 'ai-model-input';
        document.body.appendChild(modelInput);

        const modelBtn = document.createElement('button');
        modelBtn.className = 'io-btn';
        modelBtn.id = 'ai-model-btn';
        modelBtn.title = 'Select local ONNX model';
        modelBtn.textContent = 'Model';
        container.insertBefore(modelBtn, container.firstChild);

        const fillBtn = document.createElement('button');
        fillBtn.className = 'io-btn';
        fillBtn.id = 'ai-fill-btn';
        fillBtn.title = 'Fill fields using selected ONNX model';
        fillBtn.textContent = 'AI Fill';
        container.insertBefore(fillBtn, container.firstChild);

        modelBtn.addEventListener('click', () => {
            log('model button clicked');
            modelInput.click();
        });

        modelInput.addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) {
                warn('model selection canceled');
                return;
            }
            try {
                const buffer = await file.arrayBuffer();
                selectedModel = {
                    name: file.name,
                    bytes: buffer
                };
                log('model loaded', { name: file.name, bytes: buffer.byteLength });
                showNotification(`Model loaded: ${file.name}`, 'success');
            } catch (err) {
                errlog('failed to read model file', err);
                selectedModel = null;
                showNotification('Failed to load model file', 'error');
            }
        });

        fillBtn.addEventListener('click', () => {
            log('AI Fill clicked');
            if (!selectedModel || !selectedModel.bytes) {
                warn('fill blocked: model not selected');
                showNotification('Please select an ONNX model first', 'error');
                return;
            }

            getDataItemsFromStorage((dataItems) => {
                if (!dataItems.length) {
                    warn('fill blocked: no data items');
                    showNotification('No saved data items', 'error');
                    return;
                }

                log('posting fill request to content script', {
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
                showNotification(`Running ONNX model: ${selectedModel.name}`, 'info');
            });
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        const data = event.data;
        if (!data || data.type !== 'DATA_FILLER_AI_FILL_RESULT') return;
        log('received fill result', data);
        if (data.success) {
            showNotification(`AI fill completed: ${data.filledCount || 0} fields`, 'success');
        } else {
            showNotification(`AI fill failed: ${data.message || 'unknown'}`, 'error');
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupButton);
    } else {
        setupButton();
    }
})();
