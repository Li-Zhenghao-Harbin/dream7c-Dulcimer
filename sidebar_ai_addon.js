// 侧栏增强脚本：选择本地 ONNX 模型并触发 AI 填充。
(function () {
    let selectedModel = null;
    const LOG_PREFIX = '[AI填充][侧栏]';
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
            log('已读取 dataItems', { count: Array.isArray(result.dataItems) ? result.dataItems.length : 0 });
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
        modelBtn.title = '选择本地 ONNX 模型';
        modelBtn.textContent = '选择模型';
        container.insertBefore(modelBtn, container.firstChild);

        const fillBtn = document.createElement('button');
        fillBtn.className = 'io-btn';
        fillBtn.id = 'ai-fill-btn';
        fillBtn.title = '使用已选 ONNX 模型填充字段';
        fillBtn.textContent = 'AI填充';
        container.insertBefore(fillBtn, container.firstChild);

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
                selectedModel = {
                    name: file.name,
                    bytes: buffer
                };
                log('模型加载完成', { name: file.name, bytes: buffer.byteLength });
                showNotification(`模型已加载：${file.name}`, 'success');
            } catch (err) {
                errlog('读取模型文件失败', err);
                selectedModel = null;
                showNotification('模型文件加载失败', 'error');
            }
        });

        fillBtn.addEventListener('click', () => {
            log('点击 AI 填充');
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

                log('向 content script 发送填充请求', {
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
                showNotification(`正在运行 ONNX 模型：${selectedModel.name}`, 'info');
            });
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        const data = event.data;
        if (!data || data.type !== 'DATA_FILLER_AI_FILL_RESULT') return;
        log('收到填充结果', data);
        if (data.success) {
            showNotification(`AI填充完成：已填充 ${data.filledCount || 0} 项`, 'success');
        } else {
            showNotification(`AI填充失败：${data.message || '未知错误'}`, 'error');
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupButton);
    } else {
        setupButton();
    }
})();
