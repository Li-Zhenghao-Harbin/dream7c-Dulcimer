// 侧边栏数据管理器
class SidebarManager {
    constructor() {
        this.dataItems = [];
        this.groups = [];
        this.currentFilterGroupId = 'all';
        this.isGroupPanelCollapsed = true;
        this.isAddFormCollapsed = false;
        this.currentEditId = null;
        this.draggedItem = null;
        this.dragStartIndex = null;

        this.init();
    }

    async init() {
        await this.loadData();
        this.renderGroupControls();
        this.renderDataList();
        this.bindEvents();

        window.addEventListener('message', this.handleMessage.bind(this));
    }

    normalizeGroups(groups) {
        if (!Array.isArray(groups)) {
            return [];
        }

        const normalized = [];
        const usedNames = new Set();

        groups.forEach((group) => {
            if (!group || typeof group.name !== 'string') {
                return;
            }

            const name = group.name.trim();
            if (!name) {
                return;
            }

            const key = name.toLowerCase();
            if (usedNames.has(key)) {
                return;
            }

            usedNames.add(key);
            normalized.push({
                id: Number(group.id) || (normalized.length + 1),
                name
            });
        });

        return normalized;
    }

    normalizeDataItems(items, groupIdsSet) {
        if (!Array.isArray(items)) {
            return [];
        }

        return items
            .filter(item => item && item.id && item.name && item.value)
            .map((item) => {
                const groupIds = Array.isArray(item.groupIds)
                    ? [...new Set(item.groupIds.map(id => Number(id)).filter(id => groupIdsSet.has(id)))]
                    : [];

                return {
                    ...item,
                    id: Number(item.id),
                    name: String(item.name),
                    value: String(item.value),
                    groupIds
                };
            });
    }

    async loadData() {
        try {
            return new Promise((resolve) => {
                chrome.storage.local.get(['dataItems', 'dataItemsBackup', 'groups', 'groupsBackup'], (result) => {
                    if (chrome.runtime.lastError) {
                        console.error('加载数据时出错:', chrome.runtime.lastError);
                        this.dataItems = this.getDefaultData();
                        this.groups = [];
                        resolve();
                        return;
                    }

                    const primaryGroups = Array.isArray(result.groups) ? result.groups : null;
                    const backupGroups = Array.isArray(result.groupsBackup) ? result.groupsBackup : null;
                    const primaryData = Array.isArray(result.dataItems) ? result.dataItems : null;
                    const backupData = Array.isArray(result.dataItemsBackup) ? result.dataItemsBackup : null;

                    const resolvedGroups = this.normalizeGroups(primaryGroups || backupGroups || []);
                    const validGroupIds = new Set(resolvedGroups.map(group => group.id));
                    const resolvedItems = this.normalizeDataItems(primaryData || backupData || this.getDefaultData(), validGroupIds);

                    if (!primaryData && backupData) {
                        chrome.storage.local.set({ dataItems: resolvedItems }, () => {
                            if (chrome.runtime.lastError) {
                                console.error('自动恢复主数据失败:', chrome.runtime.lastError);
                            }
                        });
                    }

                    if (!primaryGroups && backupGroups) {
                        chrome.storage.local.set({ groups: resolvedGroups }, () => {
                            if (chrome.runtime.lastError) {
                                console.error('自动恢复分组数据失败:', chrome.runtime.lastError);
                            }
                        });
                    }

                    this.groups = resolvedGroups;
                    this.dataItems = resolvedItems;
                    resolve();
                });
            });
        } catch (error) {
            console.error('加载数据失败:', error);
            this.dataItems = this.getDefaultData();
            this.groups = [];
        }
    }

    getDefaultData() {
        return [];
    }

    async saveData() {
        try {
            return new Promise((resolve) => {
                chrome.storage.local.set({
                    dataItems: this.dataItems,
                    dataItemsBackup: this.dataItems,
                    groups: this.groups,
                    groupsBackup: this.groups,
                    dataItemsUpdatedAt: Date.now()
                }, () => {
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

    renderGroupControls() {
        const selector = document.getElementById('group-selector');
        const list = document.getElementById('group-list');
        const filter = document.getElementById('group-filter');

        filter.innerHTML = '<option value="all">全部分组</option>';
        this.groups.forEach((group) => {
            filter.innerHTML += `<option value="${group.id}">${group.name}</option>`;
        });

        if (this.currentFilterGroupId !== 'all') {
            const stillExists = this.groups.some(group => String(group.id) === String(this.currentFilterGroupId));
            if (!stillExists) {
                this.currentFilterGroupId = 'all';
            }
        }
        filter.value = String(this.currentFilterGroupId);

        if (!this.groups.length) {
            list.innerHTML = '<div class="group-selector-empty">暂无分组</div>';
            selector.innerHTML = '<div class="group-selector-empty">请先创建分组</div>';
            return;
        }

        list.innerHTML = this.groups.map(group => `
            <div class="group-chip" data-group-id="${group.id}">
                <span>${group.name}</span>
                <button type="button" data-action="rename" data-group-id="${group.id}" title="重命名">✎</button>
                <button type="button" data-action="delete" data-group-id="${group.id}" title="删除">×</button>
            </div>
        `).join('');

        selector.innerHTML = this.groups.map(group => `
            <label class="group-selector-item">
                <input type="checkbox" class="group-selector-checkbox" value="${group.id}">
                <span class="group-selector-text">${group.name}</span>
            </label>
        `).join('');
    }

    getFilteredDataItems() {
        if (this.currentFilterGroupId === 'all') {
            return this.dataItems;
        }

        const groupId = Number(this.currentFilterGroupId);
        return this.dataItems.filter(item => Array.isArray(item.groupIds) && item.groupIds.includes(groupId));
    }

    getGroupNamesByIds(groupIds) {
        if (!Array.isArray(groupIds) || !groupIds.length) {
            return [];
        }

        const groupMap = new Map(this.groups.map(group => [group.id, group.name]));
        return groupIds.map(id => groupMap.get(Number(id))).filter(Boolean);
    }

    renderDataList() {
        const container = document.getElementById('data-list');
        const items = this.getFilteredDataItems();

        if (!items.length) {
            container.innerHTML = '<div class="empty-state">当前分组暂无数据</div>';
            return;
        }

        let html = '';
        items.forEach(item => {
            html += this.createDataItemHTML(item);
        });

        container.innerHTML = html;
        this.bindDataItemEvents();
    }

    createDataItemHTML(item) {
        const groupNames = this.getGroupNamesByIds(item.groupIds);
        const groupsHTML = groupNames.length
            ? groupNames.map(name => `<span class="data-group-tag">${name}</span>`).join('')
            : '<span class="no-group-text">未分组</span>';

        const canDrag = this.currentFilterGroupId === 'all';
        const dragHandleTitle = canDrag ? '拖拽调整顺序' : '请在“全部分组”下拖拽排序';

        return `
      <div class="data-item" data-id="${item.id}" draggable="${canDrag}">
        <div class="drag-handle" title="${dragHandleTitle}">⋮⋮</div>
        <div class="data-info">
          <div class="data-name">${item.name}</div>
          <div class="data-value" title="${item.value}">${item.value}</div>
          <div class="data-groups">${groupsHTML}</div>
        </div>
        <div class="data-actions">
          <button class="edit-btn" data-id="${item.id}" title="编辑">✎</button>
          <button class="delete-btn" data-id="${item.id}" title="删除">X</button>
        </div>
      </div>
    `;
    }

    bindDataItemEvents() {
        document.querySelectorAll('.data-item .data-info').forEach(info => {
            info.addEventListener('click', (e) => {
                const itemElement = e.target.closest('.data-item');
                if (!itemElement) {
                    return;
                }

                const id = parseInt(itemElement.dataset.id, 10);
                const dataItem = this.dataItems.find(d => d.id === id);
                if (dataItem) {
                    this.fillData(dataItem);
                }
            });
        });

        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id, 10);
                this.editData(id);
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id, 10);
                this.deleteData(id);
            });
        });

        this.bindDragEvents();
    }

    bindDragEvents() {
        if (this.currentFilterGroupId !== 'all') {
            return;
        }

        const items = document.querySelectorAll('.data-item');

        items.forEach(item => {
            item.addEventListener('dragstart', () => {
                this.draggedItem = item;
                this.dragStartIndex = Array.from(items).indexOf(item);
                setTimeout(() => {
                    item.classList.add('dragging');
                }, 0);
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                this.draggedItem = null;
                this.dragStartIndex = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
            });

            item.addEventListener('dragenter', (e) => {
                e.preventDefault();
                if (item === this.draggedItem) {
                    return;
                }

                const itemsArray = Array.from(items);
                const dragOverIndex = itemsArray.indexOf(item);

                if (this.dragStartIndex < dragOverIndex) {
                    item.parentNode.insertBefore(this.draggedItem, item.nextSibling);
                } else {
                    item.parentNode.insertBefore(this.draggedItem, item);
                }

                this.reorderDataItems();
            });
        });
    }

    reorderDataItems() {
        if (this.currentFilterGroupId !== 'all') {
            return;
        }

        const newOrder = [];
        const items = document.querySelectorAll('.data-item');

        items.forEach(item => {
            const id = parseInt(item.dataset.id, 10);
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

        document.getElementById('data-name').value = item.name;
        document.getElementById('data-value').value = item.value;
        this.setSelectedGroupIds(item.groupIds || []);

        document.getElementById('form-title').textContent = '编辑数据';
        document.getElementById('add-btn').style.display = 'none';
        document.getElementById('update-btn').style.display = 'block';
        document.getElementById('cancel-btn').style.display = 'block';

        document.getElementById('data-name').focus();
        document.getElementById('data-name').select();

        if (this.isAddFormCollapsed) {
            this.isAddFormCollapsed = false;
            this.updateAddFormState();
        }

        this.showNotification(`正在编辑: ${item.name}`, 'info');
    }

    getSelectedGroupIds() {
        return Array.from(document.querySelectorAll('.group-selector-checkbox:checked'))
            .map(input => Number(input.value))
            .filter(id => this.groups.some(group => group.id === id));
    }

    setSelectedGroupIds(groupIds) {
        const idsSet = new Set((groupIds || []).map(id => Number(id)));
        document.querySelectorAll('.group-selector-checkbox').forEach((input) => {
            input.checked = idsSet.has(Number(input.value));
        });
    }

    addData() {
        const nameInput = document.getElementById('data-name');
        const valueInput = document.getElementById('data-value');

        const name = nameInput.value.trim();
        const value = valueInput.value.trim();
        const selectedGroupIds = this.getSelectedGroupIds();

        if (!name || !value) {
            this.showNotification('请输入名称和内容', 'error');
            return;
        }

        if (this.currentEditId) {
            this.updateExistingData(name, value, selectedGroupIds);
        } else {
            this.addNewData(name, value, selectedGroupIds);
        }
    }

    updateExistingData(name, value, groupIds) {
        const existingItem = this.dataItems.find(item =>
            item.name.toLowerCase() === name.toLowerCase() &&
            item.id !== this.currentEditId
        );

        if (existingItem) {
            this.showNotification('数据名称已存在', 'error');
            return;
        }

        const index = this.dataItems.findIndex(item => item.id === this.currentEditId);
        if (index === -1) {
            this.showNotification('要更新的数据不存在', 'error');
            return;
        }

        this.dataItems[index] = {
            ...this.dataItems[index],
            name,
            value,
            groupIds,
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

    addNewData(name, value, groupIds) {
        const existingItem = this.dataItems.find(item =>
            item.name.toLowerCase() === name.toLowerCase()
        );

        if (existingItem) {
            this.showNotification('数据名称已存在', 'error');
            return;
        }

        const newId = this.dataItems.length > 0
            ? Math.max(...this.dataItems.map(item => item.id)) + 1
            : 1;

        this.dataItems.push({
            id: newId,
            name,
            value,
            groupIds,
            createdAt: Date.now()
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

            if (id === this.currentEditId) {
                this.resetForm();
            }
        }).catch(error => {
            console.error('删除数据失败:', error);
            this.showNotification('删除数据失败', 'error');
        });
    }

    createGroup() {
        const nameInput = document.getElementById('group-name');
        const name = nameInput.value.trim();

        if (!name) {
            this.showNotification('请输入分组名称', 'error');
            return;
        }

        const duplicate = this.groups.some(group => group.name.toLowerCase() === name.toLowerCase());
        if (duplicate) {
            this.showNotification('分组名称已存在', 'error');
            return;
        }

        const newId = this.groups.length > 0
            ? Math.max(...this.groups.map(group => group.id)) + 1
            : 1;

        this.groups.push({ id: newId, name });
        nameInput.value = '';

        this.renderGroupControls();
        this.saveData().then(() => {
            this.showNotification('分组已创建', 'success');
        });
    }

    renameGroup(groupId) {
        const group = this.groups.find(item => item.id === groupId);
        if (!group) {
            this.showNotification('分组不存在', 'error');
            return;
        }

        const newName = prompt('请输入新的分组名称：', group.name);
        if (newName === null) {
            return;
        }

        const name = newName.trim();
        if (!name) {
            this.showNotification('分组名称不能为空', 'error');
            return;
        }

        const duplicate = this.groups.some(item => item.id !== groupId && item.name.toLowerCase() === name.toLowerCase());
        if (duplicate) {
            this.showNotification('分组名称已存在', 'error');
            return;
        }

        group.name = name;
        this.renderGroupControls();
        this.renderDataList();
        this.saveData().then(() => {
            this.showNotification('分组已重命名', 'success');
        });
    }

    deleteGroup(groupId) {
        const target = this.groups.find(group => group.id === groupId);
        if (!target) {
            return;
        }

        if (!confirm(`确定删除分组“${target.name}”吗？\n删除后条目不会被删除，只会移出该分组。`)) {
            return;
        }

        this.groups = this.groups.filter(group => group.id !== groupId);
        this.dataItems = this.dataItems.map(item => ({
            ...item,
            groupIds: (item.groupIds || []).filter(id => id !== groupId)
        }));

        if (String(this.currentFilterGroupId) === String(groupId)) {
            this.currentFilterGroupId = 'all';
        }

        this.renderGroupControls();
        this.renderDataList();
        this.setSelectedGroupIds(this.getSelectedGroupIds());

        this.saveData().then(() => {
            this.showNotification('分组已删除', 'success');
        });
    }

    resetForm() {
        this.currentEditId = null;

        document.getElementById('data-name').value = '';
        document.getElementById('data-value').value = '';
        this.setSelectedGroupIds([]);

        document.getElementById('form-title').textContent = '添加新数据';
        document.getElementById('add-btn').style.display = 'block';
        document.getElementById('update-btn').style.display = 'none';
        document.getElementById('cancel-btn').style.display = 'none';

        document.getElementById('data-name').focus();
    }

    parseImportedData(payload) {
        if (Array.isArray(payload)) {
            return {
                groups: [],
                dataItems: payload
            };
        }

        if (!payload || typeof payload !== 'object') {
            throw new Error('导入数据格式错误');
        }

        if (!Array.isArray(payload.dataItems)) {
            throw new Error('导入失败: dataItems 必须是数组');
        }

        return {
            groups: Array.isArray(payload.groups) ? payload.groups : [],
            dataItems: payload.dataItems
        };
    }

    validateImportedItems(items) {
        for (const item of items) {
            if (!item.id || !item.name || !item.value) {
                throw new Error('导入失败: 数据项缺少必要字段');
            }
        }
    }

    bindEvents() {
        document.getElementById('add-btn').addEventListener('click', () => {
            this.addData();
        });

        document.getElementById('update-btn').addEventListener('click', () => {
            this.addData();
        });

        document.getElementById('cancel-btn').addEventListener('click', () => {
            this.resetForm();
        });

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

        document.getElementById('group-name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.createGroup();
            }
        });

        document.getElementById('create-group-btn').addEventListener('click', () => {
            this.createGroup();
        });

        document.getElementById('group-filter').addEventListener('change', (e) => {
            this.currentFilterGroupId = e.target.value;
            this.renderGroupControls();
            this.renderDataList();
        });

        document.getElementById('group-list').addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) {
                return;
            }

            const action = button.dataset.action;
            const groupId = Number(button.dataset.groupId);

            if (action === 'rename') {
                this.renameGroup(groupId);
            } else if (action === 'delete') {
                this.deleteGroup(groupId);
            }
        });

        document.getElementById('toggle-group-panel-btn').addEventListener('click', () => {
            this.toggleGroupPanel();
        });

        document.getElementById('toggle-add-form-btn').addEventListener('click', () => {
            this.toggleAddForm();
        });

        document.getElementById('close-btn').addEventListener('click', () => {
            this.hideSidebar();
        });

        document.getElementById('import-btn').addEventListener('click', () => {
            const hiddenFileInput = document.getElementById('hidden-file-input');
            hiddenFileInput.click();
        });

        document.getElementById('hidden-file-input').addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) {
                return;
            }

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const raw = JSON.parse(e.target.result);
                    const parsed = this.parseImportedData(raw);
                    this.validateImportedItems(parsed.dataItems);

                    const normalizedGroups = this.normalizeGroups(parsed.groups);
                    const validGroupIds = new Set(normalizedGroups.map(group => group.id));
                    const normalizedItems = this.normalizeDataItems(parsed.dataItems, validGroupIds);

                    this.groups = normalizedGroups;
                    this.dataItems = normalizedItems;
                    this.currentFilterGroupId = 'all';

                    await this.saveData();
                    this.renderGroupControls();
                    this.renderDataList();
                    this.resetForm();

                    this.showNotification(`成功导入 ${normalizedItems.length} 条数据`, 'success');
                } catch (error) {
                    console.error('导入失败:', error);
                    this.showNotification(error.message || '导入失败: 文件格式不正确', 'error');
                }
            };

            reader.onerror = () => {
                this.showNotification('读取文件失败', 'error');
            };

            reader.readAsText(file);
            event.target.value = '';
        });

        document.getElementById('export-btn').addEventListener('click', () => {
            exportJSON({
                version: 2,
                exportedAt: Date.now(),
                groups: this.groups,
                dataItems: this.dataItems
            }, '扬琴.json');
        });

        document.getElementById('about').addEventListener('click', () => {
            alert('柒幻 扬琴\nv 1.2\nwww.dream7c.com');
        });

        function exportJSON(data, filename = 'data.json') {
            const jsonString = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        }

        setTimeout(() => {
            const nameInput = document.getElementById('data-name');
            if (nameInput) {
                nameInput.focus();
            }
        }, 100);

        this.updateGroupPanelState();
        this.updateAddFormState();
    }

    updateGroupPanelState() {
        const panel = document.getElementById('group-panel');
        const toggleBtn = document.getElementById('toggle-group-panel-btn');

        if (!panel || !toggleBtn) {
            return;
        }

        panel.classList.toggle('collapsed', this.isGroupPanelCollapsed);
        toggleBtn.textContent = this.isGroupPanelCollapsed ? '展开' : '收起';
    }

    toggleGroupPanel() {
        this.isGroupPanelCollapsed = !this.isGroupPanelCollapsed;
        this.updateGroupPanelState();
    }

    updateAddFormState() {
        const panel = document.getElementById('add-form');
        const toggleBtn = document.getElementById('toggle-add-form-btn');

        if (!panel || !toggleBtn) {
            return;
        }

        panel.classList.toggle('collapsed', this.isAddFormCollapsed);
        toggleBtn.textContent = this.isAddFormCollapsed ? '展开' : '收起';
    }

    toggleAddForm() {
        this.isAddFormCollapsed = !this.isAddFormCollapsed;
        this.updateAddFormState();
    }

    hideSidebar() {
        window.parent.postMessage({
            type: 'DATA_FILLER_HIDE_SIDEBAR'
        }, '*');
    }

    showNotification(message, type = 'success') {
        const oldNotification = document.querySelector('.notification');
        if (oldNotification) {
            oldNotification.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }

    handleMessage(event) {
        if (event.source !== window.parent) {
            return;
        }

        const data = event.data;
        if (!data || !data.type) {
            return;
        }

        switch (data.type) {
            case 'DATA_FILLER_SHOW_SIDEBAR':
                break;
            case 'DATA_FILLER_HIDE_SIDEBAR':
                break;
            case 'DATA_FILLER_FILL_RESULT':
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
