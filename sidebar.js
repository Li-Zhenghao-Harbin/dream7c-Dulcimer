// 侧边栏数据管理器
class SidebarManager {
    constructor() {
        this.dataItems = [];
        this.currentEditId = null; // 当前正在编辑的数据ID
        this.draggedItem = null;
        this.dragStartIndex = null;

        this.init();
    }

    async init() {
        await this.loadData();
        this.renderDataList();
        this.bindEvents();

        // console.log('侧边栏已初始化');

        // 监听来自父页面的消息
        window.addEventListener('message', this.handleMessage.bind(this));
    }

    async loadData() {
        try {
            return new Promise((resolve) => {
                chrome.storage.local.get(['dataItems'], (result) => {
                    if (chrome.runtime.lastError) {
                        console.error('加载数据时出错:', chrome.runtime.lastError);
                        this.dataItems = this.getDefaultData();
                    } else {
                        this.dataItems = result.dataItems || this.getDefaultData();
                    }
                    resolve();
                });
            });
        } catch (error) {
            console.error('加载数据失败:', error);
            this.dataItems = this.getDefaultData();
        }
    }

    getDefaultData() {
        return [];
        // return [
        //     { id: 1, name: '电话', value: '13800138000', createdAt: Date.now() },
        //     { id: 2, name: '邮箱', value: 'example@test.com', createdAt: Date.now() }
        // ];
    }

    async saveData() {
        // console.log("dataitems: ", this.dataItems);
        try {
            return new Promise((resolve) => {
                chrome.storage.local.set({ dataItems: this.dataItems }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('保存数据时出错:', chrome.runtime.lastError);
                    }
                    resolve();
                });
            });
        } catch (error) {
            console.error('保存数据失败:', error);
        }
    }

    renderDataList() {
        const container = document.getElementById('data-list');

        if (!this.dataItems || this.dataItems.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无数据，请先添加</div>';
            return;
        }

        let html = '';
        this.dataItems.forEach(item => {
            html += this.createDataItemHTML(item);
        });

        container.innerHTML = html;

        // 绑定数据项事件
        this.bindDataItemEvents();
    }

    createDataItemHTML(item) {
        return `
      <div class="data-item" data-id="${item.id}" draggable="true">
        <div class="drag-handle" title="拖拽调整顺序">⋮⋮</div>
        <div class="data-info">
          <div class="data-name">${item.name}</div>
          <div class="data-value" title="${item.value}">${item.value}</div>
        </div>
        <div class="data-actions">
          <button class="edit-btn" data-id="${item.id}" title="编辑">✎</button>
          <button class="delete-btn" data-id="${item.id}" title="删除">X</button>
        </div>
      </div>
    `;
    }

    bindDataItemEvents() {
        // 绑定点击填充事件
        document.querySelectorAll('.data-item .data-info').forEach(info => {
            info.addEventListener('click', (e) => {
                const itemElement = e.target.closest('.data-item');
                if (itemElement) {
                    const id = parseInt(itemElement.dataset.id);
                    const dataItem = this.dataItems.find(d => d.id === id);
                    if (dataItem) {
                        this.fillData(dataItem);
                    }
                }
            });
        });

        // 绑定编辑按钮事件
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                this.editData(id);
            });
        });

        // 绑定删除按钮事件
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                this.deleteData(id);
            });
        });

        // 绑定拖拽事件
        this.bindDragEvents();
    }

    bindDragEvents() {
        const items = document.querySelectorAll('.data-item');

        items.forEach(item => {
            // 拖拽开始
            item.addEventListener('dragstart', (e) => {
                this.draggedItem = item;
                this.dragStartIndex = Array.from(items).indexOf(item);
                setTimeout(() => {
                    item.classList.add('dragging');
                }, 0);
            });

            // 拖拽结束
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                this.draggedItem = null;
                this.dragStartIndex = null;
            });

            // 拖拽经过
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
            });

            // 拖拽进入
            item.addEventListener('dragenter', (e) => {
                e.preventDefault();
                if (item !== this.draggedItem) {
                    const itemsArray = Array.from(items);
                    const dragOverIndex = itemsArray.indexOf(item);

                    // 重新排序DOM元素
                    if (this.dragStartIndex < dragOverIndex) {
                        item.parentNode.insertBefore(this.draggedItem, item.nextSibling);
                    } else {
                        item.parentNode.insertBefore(this.draggedItem, item);
                    }

                    // 更新数组顺序
                    this.reorderDataItems();
                }
            });
        });
    }

    reorderDataItems() {
        // 根据当前DOM顺序更新数据数组
        const newOrder = [];
        const items = document.querySelectorAll('.data-item');

        items.forEach(item => {
            const id = parseInt(item.dataset.id);
            const dataItem = this.dataItems.find(d => d.id === id);
            if (dataItem) {
                newOrder.push(dataItem);
            }
        });

        this.dataItems = newOrder;
        this.saveData().then(() => {
            this.showNotification('顺序已保存', 'success');
        });
    }

    fillData(dataItem) {
        // console.log('填充数据:', dataItem);

        // 发送消息给父页面（content script）
        window.parent.postMessage({
            type: 'DATA_FILLER_FILL_DATA',
            data: dataItem
        }, '*');

        this.showNotification(`正在填充: ${dataItem.name}`, 'info');
    }

    editData(id) {
        const item = this.dataItems.find(d => d.id === id);
        if (!item) {
            this.showNotification('数据不存在', 'error');
            return;
        }

        this.currentEditId = id;

        // 填充表单
        document.getElementById('data-name').value = item.name;
        document.getElementById('data-value').value = item.value;

        // 切换表单模式
        document.getElementById('form-title').textContent = '编辑数据';
        document.getElementById('add-btn').style.display = 'none';
        document.getElementById('update-btn').style.display = 'block';
        document.getElementById('cancel-btn').style.display = 'block';

        // 聚焦到名称输入框
        document.getElementById('data-name').focus();
        document.getElementById('data-name').select();

        this.showNotification(`正在编辑: ${item.name}`, 'info');
    }

    addData() {
        const nameInput = document.getElementById('data-name');
        const valueInput = document.getElementById('data-value');

        const name = nameInput.value.trim();
        const value = valueInput.value.trim();

        if (!name || !value) {
            this.showNotification('请输入名称和内容', 'error');
            return;
        }

        if (this.currentEditId) {
            // 更新现有数据
            this.updateExistingData(name, value);
        } else {
            // 添加新数据
            this.addNewData(name, value);
        }
    }

    updateExistingData(name, value) {
        // 检查名称是否已存在（排除当前编辑的项）
        const existingItem = this.dataItems.find(item =>
            item.name.toLowerCase() === name.toLowerCase() &&
            item.id !== this.currentEditId
        );

        if (existingItem) {
            this.showNotification('数据名称已存在', 'error');
            return;
        }

        // 更新现有数据
        const index = this.dataItems.findIndex(item => item.id === this.currentEditId);
        if (index !== -1) {
            this.dataItems[index] = {
                ...this.dataItems[index],
                name: name,
                value: value,
                updatedAt: Date.now()
            };

            this.saveData().then(() => {
                this.renderDataList();
                this.resetForm();
                this.showNotification('数据已更新', 'success');
            }).catch(error => {
                console.error('更新数据失败:', error);
                this.showNotification('更新数据失败', 'error');
            });
        }
    }

    addNewData(name, value) {
        // 检查名称是否已存在
        const existingItem = this.dataItems.find(item =>
            item.name.toLowerCase() === name.toLowerCase()
        );

        if (existingItem) {
            this.showNotification('数据名称已存在', 'error');
            return;
        }

        // 添加新数据
        const newId = this.dataItems.length > 0
            ? Math.max(...this.dataItems.map(item => item.id)) + 1
            : 1;

        this.dataItems.push({
            id: newId,
            name: name,
            value: value
            // createdAt: Date.now()
        });

        this.saveData().then(() => {
            this.renderDataList();
            this.resetForm();
            this.showNotification('数据已添加', 'success');
        }).catch(error => {
            console.error('添加数据失败:', error);
            this.showNotification('添加数据失败', 'error');
        });
    }

    deleteData(id) {
        if (!confirm('确定要删除这条数据吗？')) {
            return;
        }

        this.dataItems = this.dataItems.filter(item => item.id !== id);

        this.saveData().then(() => {
            this.renderDataList();
            this.showNotification('数据已删除', 'success');

            // 如果删除的是当前正在编辑的数据，重置表单
            if (id === this.currentEditId) {
                this.resetForm();
            }
        }).catch(error => {
            console.error('删除数据失败:', error);
            this.showNotification('删除数据失败', 'error');
        });
    }

    resetForm() {
        this.currentEditId = null;

        document.getElementById('data-name').value = '';
        document.getElementById('data-value').value = '';

        document.getElementById('form-title').textContent = '添加新数据';
        document.getElementById('add-btn').style.display = 'block';
        document.getElementById('update-btn').style.display = 'none';
        document.getElementById('cancel-btn').style.display = 'none';

        // 聚焦到名称输入框
        document.getElementById('data-name').focus();
    }

    bindEvents() {
        // 添加按钮
        document.getElementById('add-btn').addEventListener('click', () => {
            this.addData();
        });

        // 更新按钮
        document.getElementById('update-btn').addEventListener('click', () => {
            this.addData();
        });

        // 取消按钮
        document.getElementById('cancel-btn').addEventListener('click', () => {
            this.resetForm();
        });

        // 输入框回车提交
        document.getElementById('data-name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addData();
            }
        });

        document.getElementById('data-value').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addData();
            }
        });

        // 关闭按钮
        document.getElementById('close-btn').addEventListener('click', () => {
            this.hideSidebar();
        });

        // 导入
        document.getElementById('import-btn').addEventListener('click', () => {
            const hiddenFileInput = document.getElementById('hidden-file-input');
            hiddenFileInput.click();
        });

        document.getElementById('hidden-file-input').addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);

                    // 验证数据格式
                    if (!Array.isArray(data)) {
                        this.showNotification('导入失败: 数据必须是数组格式', 'error');
                        return;
                    }

                    // 验证每个数据项
                    for (let item of data) {
                        if (!item.id || !item.name || !item.value) {
                            this.showNotification('导入失败: 数据项缺少必要字段', 'error');
                            return;
                        }
                    }

                    // 清空当前数据
                    this.dataItems = [];

                    // 使用导入的数据
                    this.dataItems = data;

                    // 保存到 chrome.storage
                    await this.saveData();

                    // 重新渲染列表
                    this.renderDataList();
                    this.resetForm();

                    this.showNotification(`成功导入 ${data.length} 条数据`, 'success');
                } catch (error) {
                    console.error('导入失败:', error);
                    this.showNotification('导入失败: 文件格式不正确', 'error');
                }
            };

            reader.onerror = () => {
                this.showNotification('读取文件失败', 'error');
            };

            reader.readAsText(file);

            // 重置文件输入
            event.target.value = '';
        });

        // 导出
        document.getElementById('export-btn').addEventListener('click', () => {
            exportJSON(this.dataItems, '扬琴.json');
        });

        document.getElementById('about').addEventListener('click', () => {
            alert('柒幻 扬琴\nv 1.2\nwww.dream7c.com');
        })

        function exportJSON(data, filename = 'data.json') {
            // 将 JSON 数据转换为字符串
            const jsonString = JSON.stringify(data, null, 2);
            // 创建 Blob 对象
            const blob = new Blob([jsonString], { type: 'application/json' });
            // 创建下载链接
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            // 触发下载
            a.click();
            // 释放 URL 对象
            URL.revokeObjectURL(url);
        }

        // 自动聚焦到名称输入框
        setTimeout(() => {
            const nameInput = document.getElementById('data-name');
            if (nameInput) {
                nameInput.focus();
            }
        }, 100);
    }

    hideSidebar() {
        // 发送消息给父页面隐藏侧边栏
        window.parent.postMessage({
            type: 'DATA_FILLER_HIDE_SIDEBAR'
        }, '*');
    }

    showNotification(message, type = 'success') {
        // 移除旧的通知
        const oldNotification = document.querySelector('.notification');
        if (oldNotification) {
            oldNotification.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        // 3秒后自动移除
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }

    handleMessage(event) {
        // 确保消息来自可信的来源
        if (event.source !== window.parent) {
            return;
        }

        const data = event.data;
        // console.log('侧边栏收到消息:', data);

        if (!data || !data.type) {
            return;
        }

        switch (data.type) {
            case 'DATA_FILLER_SHOW_SIDEBAR':
                // 侧边栏已经显示了，不需要特殊处理
                break;

            case 'DATA_FILLER_HIDE_SIDEBAR':
                // 父页面已经处理了隐藏
                break;

            case 'DATA_FILLER_FILL_RESULT':
                // 填充结果反馈
                if (data.success) {
                    this.showNotification('数据填充成功', 'success');
                } else {
                    this.showNotification(`填充失败: ${data.message}`, 'error');
                }
                break;
        }
    }
}

// 初始化侧边栏
new SidebarManager();

// console.log('侧边栏脚本已加载');