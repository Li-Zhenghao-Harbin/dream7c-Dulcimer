// console.log('数据填充器content script已加载');

// 存储当前聚焦的输入框
let lastFocusedInput = null;

// 检查元素是否是输入元素
function isInputElement(element) {
    if (!element) return false;

    const tagName = element.tagName.toLowerCase();

    // 普通输入框
    if (tagName === 'input' && element.type !== 'hidden') {
        return true;
    }

    // 文本域
    if (tagName === 'textarea') {
        return true;
    }

    // 可编辑元素
    if (element.isContentEditable) {
        return true;
    }

    return false;
}

// 监听页面点击事件，记录最后聚焦的输入框
document.addEventListener('click', function(e) {
    const target = e.target;

    if (isInputElement(target)) {
        lastFocusedInput = target;
        // console.log('记录最后聚焦的输入框:', target);
    }
});

// 监听焦点事件
document.addEventListener('focusin', function(e) {
    const target = e.target;
    if (isInputElement(target)) {
        lastFocusedInput = target;
    }
});

function emitInputEvents(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

// 覆盖设置输入框的值
function overwriteInputValue(input, value) {
    if (!input) return false;

    try {
        if (input.isContentEditable) {
            input.textContent = value;
        } else {
            input.value = value;
        }

        emitInputEvents(input);
        input.focus();
        if (input.select) {
            input.select();
        }

        return true;
    } catch (error) {
        console.error('设置输入框值时出错:', error);
        return false;
    }
}

function appendToTextInput(input, value) {
    const currentValue = String(input.value || '');
    const hasSelection = typeof input.selectionStart === 'number' && typeof input.selectionEnd === 'number';
    const insertAt = hasSelection ? input.selectionEnd : currentValue.length;
    const nextValue = currentValue.slice(0, insertAt) + value + currentValue.slice(insertAt);

    input.value = nextValue;
    emitInputEvents(input);
    input.focus();

    const caret = insertAt + value.length;
    if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(caret, caret);
    }
    return true;
}

function appendToContentEditable(input, value) {
    input.focus();

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (input.contains(range.startContainer)) {
            range.collapse(false);
            const textNode = document.createTextNode(value);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);
            emitInputEvents(input);
            return true;
        }
    }

    input.textContent = `${input.textContent || ''}${value}`;
    emitInputEvents(input);
    return true;
}

function appendInputValue(input, value) {
    if (!input) return false;

    try {
        if (input.isContentEditable) {
            return appendToContentEditable(input, value);
        }
        return appendToTextInput(input, value);
    } catch (error) {
        console.error('追加输入框值时出错:', error);
        return false;
    }
}

function applyInputValue(input, value, fillMode) {
    if (fillMode === 'append') {
        return appendInputValue(input, value);
    }
    return overwriteInputValue(input, value);
}

// 填充数据到输入框
function fillDataToInput(data, fillMode = 'overwrite') {
    // console.log('正在填充数据:', data);

    if (!data || data.value === undefined || data.value === null) {
        console.error('数据无效');
        return { success: false, message: '数据无效' };
    }

    // 首先尝试填充最后聚焦的输入框
    if (lastFocusedInput) {
        // console.log('使用最后聚焦的输入框:', lastFocusedInput);
        const result = applyInputValue(lastFocusedInput, String(data.value), fillMode);
        if (result) {
            // console.log('填充成功');
            return { success: true, message: '填充成功' };
        }
    }

    // 如果没有最后聚焦的输入框，尝试查找页面上的第一个输入框
    // console.log('查找页面上的输入框...');
    const firstInput = document.querySelector('input, textarea');
    if (firstInput) {
        // console.log('找到第一个输入框:', firstInput);
        const result = applyInputValue(firstInput, String(data.value), fillMode);
        if (result) {
            // console.log('填充成功');
            return { success: true, message: '填充成功' };
        }
    }

    console.error('未找到输入框');
    return { success: false, message: '未找到输入框' };
}

// 侧边栏管理器
class SidebarManager {
    constructor() {
        this.sidebarIframe = null;
        this.sidebarResizer = null;
        this.resizeOverlay = null;
        this.isVisible = false;
        this.sidebarWidth = 305;
        this.sidebarSide = 'right';
        this.isResizing = false;
        this.resizerWidth = 10;
        this.minSidebarWidth = 260;
        this.maxSidebarWidth = 720;

        this.init();
    }

    init() {
        this.loadSidebarLayout();

        // 监听来自background的消息
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            // console.log('收到消息:', request);

            if (request.action === 'toggleSidebar') {
                this.toggleSidebar();
                sendResponse({ success: true });
            } else if (request.action === 'showSidebar') {
                this.showSidebar();
                sendResponse({ success: true });
            } else if (request.action === 'hideSidebar') {
                this.hideSidebar();
                sendResponse({ success: true });
            }

            return true;
        });

        // 监听来自iframe的消息
        window.addEventListener('message', this.handleMessage.bind(this));
        window.addEventListener('mousemove', this.handleResizeMove.bind(this));
        window.addEventListener('mouseup', this.stopResize.bind(this));
        window.addEventListener('blur', this.stopResize.bind(this));
        window.addEventListener('resize', () => {
            this.sidebarWidth = this.normalizeSidebarWidth(this.sidebarWidth);
            this.applySidebarLayout();
        });

        // console.log('侧边栏管理器初始化完成');
    }

    loadSidebarLayout() {
        chrome.storage.local.get(['sidebarWidth', 'sidebarSide'], (result) => {
            if (chrome.runtime.lastError) {
                console.error('读取侧边栏布局失败:', chrome.runtime.lastError);
                return;
            }

            if (typeof result.sidebarWidth === 'number' && Number.isFinite(result.sidebarWidth)) {
                this.sidebarWidth = this.normalizeSidebarWidth(result.sidebarWidth);
            }

            if (result.sidebarSide === 'left' || result.sidebarSide === 'right') {
                this.sidebarSide = result.sidebarSide;
            }

            this.applySidebarLayout();
        });
    }

    normalizeSidebarWidth(width) {
        const viewportBasedMax = Math.max(this.minSidebarWidth, Math.min(this.maxSidebarWidth, window.innerWidth - 80));
        return Math.max(this.minSidebarWidth, Math.min(viewportBasedMax, Math.round(width)));
    }

    saveSidebarLayout() {
        chrome.storage.local.set({
            sidebarWidth: this.sidebarWidth,
            sidebarSide: this.sidebarSide
        }, () => {
            if (chrome.runtime.lastError) {
                console.error('保存侧边栏布局失败:', chrome.runtime.lastError);
            }
        });
    }

    applySidebarLayout() {
        if (!this.sidebarIframe) {
            return;
        }

        const side = this.sidebarSide;
        this.sidebarWidth = this.normalizeSidebarWidth(this.sidebarWidth);

        this.sidebarIframe.style.width = `${this.sidebarWidth}px`;
        this.sidebarIframe.style.left = side === 'left' ? '0' : 'auto';
        this.sidebarIframe.style.right = side === 'right' ? '0' : 'auto';
        this.sidebarIframe.dataset.side = side;
        this.sidebarIframe.classList.toggle('left-side', side === 'left');
        this.sidebarIframe.classList.toggle('right-side', side === 'right');

        if (this.sidebarResizer) {
            const handleHalf = Math.floor(this.resizerWidth / 2);
            const boundaryX = side === 'right'
                ? window.innerWidth - this.sidebarWidth
                : this.sidebarWidth;
            this.sidebarResizer.style.left = `${boundaryX - handleHalf}px`;
            this.sidebarResizer.style.right = 'auto';
            this.sidebarResizer.dataset.side = side;
        }
    }

    createResizer() {
        if (this.sidebarResizer) {
            return this.sidebarResizer;
        }

        const resizer = document.createElement('div');
        resizer.id = 'data-filler-sidebar-resizer';
        resizer.style.cssText = `
      position: fixed;
      top: 0;
      width: ${this.resizerWidth}px;
      height: 100vh;
      z-index: 2147483647;
      cursor: ew-resize;
      background: transparent;
    `;

        resizer.addEventListener('mousedown', (event) => {
            if (event.button !== 0) {
                return;
            }
            event.preventDefault();
            this.startResize();
        });

        document.body.appendChild(resizer);
        this.sidebarResizer = resizer;
        return resizer;
    }

    startResize() {
        this.isResizing = true;
        document.body.style.userSelect = 'none';

        if (!this.resizeOverlay) {
            const overlay = document.createElement('div');
            overlay.id = 'data-filler-sidebar-resize-overlay';
            overlay.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        cursor: ew-resize;
        background: transparent;
      `;
            document.body.appendChild(overlay);
            this.resizeOverlay = overlay;
        } else if (!this.resizeOverlay.parentNode) {
            document.body.appendChild(this.resizeOverlay);
        }

        if (this.sidebarIframe) {
            this.sidebarIframe.style.pointerEvents = 'none';
        }
    }

    handleResizeMove(event) {
        if (!this.isResizing || !this.sidebarIframe) {
            return;
        }

        const width = this.sidebarSide === 'right'
            ? window.innerWidth - event.clientX
            : event.clientX;

        this.sidebarWidth = this.normalizeSidebarWidth(width);
        this.applySidebarLayout();
    }

    stopResize() {
        if (!this.isResizing) {
            return;
        }

        this.isResizing = false;
        document.body.style.userSelect = '';
        if (this.resizeOverlay && this.resizeOverlay.parentNode) {
            this.resizeOverlay.parentNode.removeChild(this.resizeOverlay);
        }
        if (this.sidebarIframe) {
            this.sidebarIframe.style.pointerEvents = '';
        }
        this.saveSidebarLayout();
    }

    toggleSidebarSide() {
        this.sidebarSide = this.sidebarSide === 'right' ? 'left' : 'right';
        this.applySidebarLayout();
        this.saveSidebarLayout();
        this.sendMessageToIframe({
            type: 'DATA_FILLER_SIDEBAR_SIDE_CHANGED',
            sidebarSide: this.sidebarSide
        });
    }

    // 注入侧边栏到页面
    injectSidebar() {
        if (this.sidebarIframe) {
            // console.log('侧边栏已存在');
            return this.sidebarIframe;
        }

        // console.log('开始注入侧边栏...');

        // 创建iframe来加载侧边栏
        this.sidebarIframe = document.createElement('iframe');
        this.sidebarIframe.id = 'data-filler-sidebar-iframe';
        this.sidebarIframe.className = 'hidden';
        this.sidebarIframe.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: ${this.sidebarWidth}px;
      height: 100vh;
      border: none;
      z-index: 2147483647;
      box-shadow: -2px 0 10px rgba(0,0,0,0.1);
      background: white;
      transition: transform 0.3s ease;
    `;

        // 加载侧边栏页面
        try {
            this.sidebarIframe.src = chrome.runtime.getURL('sidebar.html');
            // console.log('侧边栏URL:', this.sidebarIframe.src);
        } catch (error) {
            console.error('获取侧边栏URL失败:', error);
            return null;
        }

        document.body.appendChild(this.sidebarIframe);
        this.createResizer();
        this.applySidebarLayout();

        // console.log('侧边栏已注入');

        return this.sidebarIframe;
    }

    toggleSidebar() {
        if (!this.sidebarIframe) {
            this.injectSidebar();
            // 等待iframe加载
            setTimeout(() => {
                this.showSidebar();
            }, 100);
            return;
        }

        if (this.isVisible) {
            this.hideSidebar();
        } else {
            this.showSidebar();
        }
    }

    showSidebar() {
        if (!this.sidebarIframe) {
            this.injectSidebar();
        }

        this.sidebarIframe.classList.remove('hidden');
        if (this.sidebarResizer) {
            this.sidebarResizer.classList.remove('hidden');
        }
        this.isVisible = true;

        // console.log('显示侧边栏');

        // 通知iframe侧边栏已显示
        this.sendMessageToIframe({
            type: 'DATA_FILLER_SHOW_SIDEBAR',
            sidebarSide: this.sidebarSide
        });
    }

    hideSidebar() {
        if (this.sidebarIframe) {
            this.sidebarIframe.classList.add('hidden');
            if (this.sidebarResizer) {
                this.sidebarResizer.classList.add('hidden');
            }
            this.isVisible = false;

            // console.log('隐藏侧边栏');

            // 通知iframe侧边栏已隐藏
            this.sendMessageToIframe({
                type: 'DATA_FILLER_HIDE_SIDEBAR'
            });
        }
    }

    sendMessageToIframe(message) {
        if (!this.sidebarIframe || !this.sidebarIframe.contentWindow) {
            console.warn('无法发送消息到iframe: iframe未就绪');
            return;
        }

        try {
            this.sidebarIframe.contentWindow.postMessage(message, '*');
        } catch (error) {
            console.error('发送消息到iframe失败:', error);
        }
    }

    handleMessage(event) {
        // 确保消息来自我们的iframe
        if (!this.sidebarIframe || event.source !== this.sidebarIframe.contentWindow) {
            return;
        }

        const data = event.data;
        // console.log('收到iframe消息:', data);

        if (!data || !data.type) {
            return;
        }

        switch (data.type) {
            case 'DATA_FILLER_FILL_DATA':
                // 填充数据到输入框
                const result = fillDataToInput(data.data, data.fillMode);

                // 发送结果回iframe
                this.sendMessageToIframe({
                    type: 'DATA_FILLER_FILL_RESULT',
                    success: result.success,
                    message: result.message
                });
                break;

            case 'DATA_FILLER_HIDE_SIDEBAR':
                // 隐藏侧边栏
                this.hideSidebar();
                break;
            case 'DATA_FILLER_TOGGLE_SIDE':
                this.toggleSidebarSide();
                break;
        }
    }
}

// 创建侧边栏管理器实例
const sidebarManager = new SidebarManager();

// 暴露给控制台调试
window.sidebarManager = sidebarManager;

// console.log('数据填充器已就绪，点击扩展图标打开侧边栏');
