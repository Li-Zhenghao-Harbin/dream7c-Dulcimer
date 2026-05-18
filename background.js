// 监听扩展图标点击
chrome.action.onClicked.addListener((tab) => {
    // console.log('扩展图标被点击，标签页:', tab.id, 'URL:', tab.url);

    // 检查标签页URL是否有效（不能是chrome://等特殊页面）
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
        // console.log('无法在此页面上运行扩展');
        return;
    }

    // 向当前标签页发送消息，切换侧边栏显示
    chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' }, (response) => {
        if (chrome.runtime.lastError) {
            // console.log('content script可能未加载:', chrome.runtime.lastError.message);
            // 这里不尝试重新注入，因为content script应该已经加载了
            // 如果出现错误，可能是页面刷新后扩展还未重新注入
        } else {
            // console.log('侧边栏切换成功');
        }
    });
});

// 扩展安装/更新时的初始化
chrome.runtime.onInstalled.addListener((details) => {
    // console.log('侧边栏数据填充器 onInstalled:', details.reason);

    // 仅首次安装时尝试初始化；更新时不能覆盖用户数据
    if (details.reason !== 'install') {
        return;
    }

    // 默认数据（留空表示首次安装时显示“暂无数据”）
    const defaultData = [
        // { id: 1, name: '电话', value: '13800138000', createdAt: Date.now() },
        // { id: 2, name: '邮箱', value: 'example@test.com', createdAt: Date.now() }
    ];

    chrome.storage.local.get(['dataItems'], (result) => {
        if (chrome.runtime.lastError) {
            console.error('读取初始化数据时出错:', chrome.runtime.lastError);
            return;
        }

        const hasExistingData = Array.isArray(result.dataItems);
        if (hasExistingData) {
            return;
        }

        chrome.storage.local.set({
            dataItems: defaultData,
            dataItemsBackup: defaultData,
            groups: [],
            groupsBackup: [],
            dataItemsUpdatedAt: Date.now()
        }, () => {
            if (chrome.runtime.lastError) {
                console.error('设置默认数据时出错:', chrome.runtime.lastError);
            } else {
                // console.log('默认数据已初始化');
            }
        });
    });
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        // console.log('页面加载完成:', tab.url);
    }
});