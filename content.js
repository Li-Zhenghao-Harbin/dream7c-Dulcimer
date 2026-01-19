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

// 设置输入框的值
function setInputValue(input, value) {
    if (!input) return false;

    try {
        // 不同类型的输入框处理
        if (input.isContentEditable) {
            input.textContent = value;
        } else {
            // 直接设置值
            input.value = value;

            // 触发输入事件，确保页面能检测到值变化
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // 聚焦并选中所有文本
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

// 填充数据到输入框
function fillDataToInput(data) {
    // console.log('正在填充数据:', data);

    if (!data || !data.value) {
        console.error('数据无效');
        return { success: false, message: '数据无效' };
    }

    // 首先尝试填充最后聚焦的输入框
    if (lastFocusedInput) {
        // console.log('使用最后聚焦的输入框:', lastFocusedInput);
        const result = setInputValue(lastFocusedInput, data.value);
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
        const result = setInputValue(firstInput, data.value);
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
        this.isVisible = false;

        this.init();
    }

    init() {
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

        // console.log('侧边栏管理器初始化完成');
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
      width: 320px;
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
        this.isVisible = true;

        // console.log('显示侧边栏');

        // 通知iframe侧边栏已显示
        this.sendMessageToIframe({
            type: 'DATA_FILLER_SHOW_SIDEBAR'
        });
    }

    hideSidebar() {
        if (this.sidebarIframe) {
            this.sidebarIframe.classList.add('hidden');
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
                const result = fillDataToInput(data.data);

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
        }
    }
}

// 创建侧边栏管理器实例
const sidebarManager = new SidebarManager();

// 暴露给控制台调试
window.sidebarManager = sidebarManager;

// console.log('数据填充器已就绪，点击扩展图标打开侧边栏');