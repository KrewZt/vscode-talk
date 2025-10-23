// media/main.js
(function () {
    // --- SECTION: State & Initialization ---

    // 获取 VS Code 的 API，用于与插件后端通信
    const vscode = acquireVsCodeApi();
    
    // DOM 元素获取
    const linesContainer = document.getElementById('lines-container');
    const exportBtn = document.getElementById('export-btn');
    const confirmModal = document.getElementById('confirm-modal');
    const modalMessage = document.getElementById('modal-message');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalContentConfirm = document.getElementById('modal-content-confirm');
    const modalContentAvatar = document.getElementById('modal-content-avatar');
    const avatarFormContainer = document.getElementById('avatar-modal-form-container');
    const avatarConfirmBtn = document.getElementById('avatar-confirm-btn');
    const avatarCancelBtn = document.getElementById('avatar-cancel-btn');
    
    // 全局状态变量
    let scriptData = []; // 存储所有对话行的数据
    let customCharacters = []; // 存储用户创建的自定义角色
    let temporaryCharacters = []; // 存储用户创建的临时角色（化名）
    let characterMap = new Map(); // 存储所有角色的映射，方便快速查找
    let confirmCallback = null; // 存储确认模态框的回调函数
    let draggedElement = null; // 当前正在被拖拽的对话行元素

    // --- SECTION: Core UI & Rendering ---

    /**
     * 根据角色ID生成一个稳定的颜色
     * @param {string} id - 角色ID
     * @returns {string} - CSS HSL 颜色字符串
     */
    function getColorForId(id) {
        if (id === 'me') { return 'hsl(30, 40%, 45%)'; }
        if (id === 'narration') { return 'hsl(170, 40%, 40%)'; }
        
        let hash = 0;
        for (let i = 0; i < id.length; i++) { 
            hash = id.charCodeAt(i) + ((hash << 5) - hash); 
        }
        const h = hash % 360;
        const s = 40;
        const l = 35;
        return `hsl(${h}, ${s}%, ${l}%)`;
    }

    /**
     * 核心渲染函数，根据 scriptData 数组更新整个对话列表的UI
     */
    function render() {
        if (!linesContainer) return;

        // 如果顶部的拖放区域不存在，则创建它
        if (!document.getElementById('drop-zone-top')) {
            const dropZone = document.createElement('div');
            dropZone.id = 'drop-zone-top';
            linesContainer.before(dropZone);
        }

        // 移除多余的 DOM 元素
        while (linesContainer.children.length > scriptData.length) {
            linesContainer.removeChild(linesContainer.lastChild);
        }

        // 添加缺失的 DOM 元素
        while (linesContainer.children.length < scriptData.length) {
            const lineEl = document.createElement('div');
            lineEl.className = 'line';
            lineEl.innerHTML = `
                <button class="character-btn" title="点击切换人物"></button>
                <div class="drag-handle" draggable="true" title="拖拽排序">⋮</div>
                <input class="line-input" type="text">
                <div class="insert-line-handle" title="在此处插入新行"></div>
            `;
            linesContainer.appendChild(lineEl);
        }

        // 遍历 scriptData，更新每一行的数据和样式
        scriptData.forEach((lineData, index) => {
            const lineEl = linesContainer.children[index];
            lineEl.dataset.index = index;
            
            // 根据角色ID添加特定的CSS类
            lineEl.classList.remove('line-type-me', 'line-type-narration');
            if (lineData.characterId === 'me') { 
                lineEl.classList.add('line-type-me'); 
            } else if (lineData.characterId === 'narration') { 
                lineEl.classList.add('line-type-narration'); 
            }

            // 获取角色信息并更新按钮文本和颜色
            const character = characterMap.get(lineData.characterId);
            const displayName = character?.short_names?.['zh-cn'] || character?.names?.['en'] || '未知角色';
            const charBtn = lineEl.querySelector('.character-btn');
            charBtn.textContent = displayName;
            charBtn.style.backgroundColor = getColorForId(lineData.characterId);

            // 更新输入框的文本内容
            const lineInput = lineEl.querySelector('.line-input');
            if (lineInput.value !== lineData.line) {
                lineInput.value = lineData.line;
            }
        });
    }

    /**
     * 将当前前端的状态（剧本、自定义角色等）发送到 VS Code 后端进行保存
     */
    function updateBackend() {
        vscode.postMessage({ 
            type: 'updateText', 
            payload: { 
                script: scriptData, 
                customCharacters: customCharacters, 
                temporaryCharacters: temporaryCharacters 
            } 
        });
    }

    // --- SECTION: Core Actions ---

    /**
     * 在指定索引后插入一个新行
     * @param {number} index - 当前行的索引
     * @param {boolean} useNarration - 是否将新行设置为旁白
     */
    function handleNewLine(index, useNarration) {
        const currentCharacterId = scriptData[index]?.characterId || 'me';
        const newCharacterId = useNarration ? 'narration' : currentCharacterId;
        const newLine = { characterId: newCharacterId, line: '' };
        
        scriptData.splice(index + 1, 0, newLine);
        render();

        // 插入后自动聚焦到新的输入框
        const nextInput = document.querySelector(`.line[data-index="${index + 1}"] .line-input`);
        if (nextInput) { 
            nextInput.focus(); 
        }
        updateBackend();
    }

    /**
     * 删除指定索引的对话行
     * @param {number} index - 要删除的行的索引
     */
    function deleteLine(index) {
        // 至少保留一行
        if (scriptData.length > 1) {
            scriptData.splice(index, 1);
            render();
            updateBackend();
        } else {
            alert("至少保留一行对话。");
        }
    }
    
    /**
     * 重新排序对话行
     * @param {number} draggedIdx - 被拖拽行的原始索引
     * @param {number} dropIdx - 目标放置位置的索引
     */
    function reorderLines(draggedIdx, dropIdx) {
        if (draggedIdx === dropIdx) return;
        
        const [draggedItem] = scriptData.splice(draggedIdx, 1);
        scriptData.splice(dropIdx, 0, draggedItem);
        
        render();
        updateBackend();
    }

    // --- SECTION: UI Components (Modals & Menu) ---

    /**
     * 显示一个通用的确认模态框
     * @param {string} message - 显示在模态框中的消息文本
     * @param {Function} onConfirm - 用户点击“确认”时执行的回调函数
     */
    function showConfirm(message, onConfirm) {
        modalContentAvatar.style.display = 'none';
        modalContentConfirm.style.display = 'block';
        modalMessage.textContent = message;
        confirmCallback = onConfirm;
        confirmModal.classList.add('modal-visible');
    }

    /**
     * 隐藏确认模态框
     */
    function hideConfirm() {
        confirmModal.classList.remove('modal-visible');
        confirmCallback = null;
    }

    /**
     * 显示导出前设置头像和自定义角色UID的模态框
     * @param {object} payload - 包含普通角色和自定义角色信息的对象
     */
    function showAvatarModal(payload) {
        const { normalChars, customChars } = payload;

        modalContentConfirm.style.display = 'none';
        modalContentAvatar.style.display = 'block';
        avatarFormContainer.innerHTML = ''; // 清空旧表单内容

        // 为普通角色创建头像输入框
        if (normalChars.length > 0) {
            const normalTitle = document.createElement('h4');
            normalTitle.textContent = '设置角色头像';
            avatarFormContainer.appendChild(normalTitle);
            normalChars.forEach(char => {
                const label = document.createElement('label');
                label.textContent = char.name;
                const input = document.createElement('input');
                input.type = 'text';
                input.dataset.charType = 'normal';
                input.dataset.charId = char.id;
                input.value = char.defaultImg;
                avatarFormContainer.appendChild(label);
                avatarFormContainer.appendChild(input);
            });
        }

        // 为自定义角色创建最终UID输入框
        if (customChars.length > 0) {
            const customTitle = document.createElement('h4');
            customTitle.textContent = '设置自定义角色UID';
            avatarFormContainer.appendChild(customTitle);
            customChars.forEach(char => {
                const label = document.createElement('label');
                label.textContent = char.name;
                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = '请输入最终UID';
                input.dataset.charType = 'custom';
                input.dataset.tempId = char.id;
                input.dataset.charName = char.name;
                avatarFormContainer.appendChild(label);
                avatarFormContainer.appendChild(input);
            });
        }

        confirmModal.classList.add('modal-visible');
    }

    /**
     * 隐藏头像设置模态框
     */
    function hideAvatarModal() {
        confirmModal.classList.remove('modal-visible');
        // 延迟切换内容，以获得更好的关闭动画效果
        setTimeout(() => {
            modalContentConfirm.style.display = 'block';
            modalContentAvatar.style.display = 'none';
        }, 200);
    }
    
    /**
     * 显示角色管理模态框，用于创建和删除临时角色（化名）
     */
    function showCharacterManagementModal() {
        modalContentConfirm.style.display = 'none';
        modalContentAvatar.style.display = 'block';
        avatarFormContainer.innerHTML = ''; // 清空内容
        
        // 1. 创建 "添加临时人物" 表单
        const createSection = document.createElement('div');
        createSection.className = 'char-management-section';
        createSection.innerHTML = `
            <h4>创建临时人物 (化名)</h4>
            <div id="temp-char-form">
                <div id="base-char-search-wrapper">
                    <input type="text" id="base-char-search-input" placeholder="搜索原型角色..." autocomplete="off">
                    <div id="base-char-results" style="display: none;"></div>
                </div>
                <input type="text" id="temp-char-name-input" placeholder="输入临时名称...">
                <button id="create-temp-char-btn" class="control-btn">创建</button>
            </div>
        `;
        avatarFormContainer.appendChild(createSection);

        // 2. 实现原型角色的搜索逻辑
        const baseCharSearchInput = document.getElementById('base-char-search-input');
        const baseCharResults = document.getElementById('base-char-results');

        baseCharSearchInput.addEventListener('input', () => {
            const filter = baseCharSearchInput.value.trim().toLowerCase();
            baseCharResults.innerHTML = '';

            if (!filter) {
                baseCharResults.style.display = 'none';
                return;
            }
            
            // 从 characterMap 中筛选出可作为原型的标准角色
            const characters = Array.from(characterMap.values())
                .filter(c => !c.isCustom && !c.isTemporary && c.id !== 'me' && c.id !== 'narration');
            
            // 根据输入内容过滤角色并生成结果列表
            characters.forEach(char => {
                const name = char.short_names['zh-cn'] || char.names.en;
                if (name.toLowerCase().includes(filter)) {
                    const item = document.createElement('div');
                    item.className = 'result-item';
                    item.textContent = name;
                    item.dataset.charId = char.id;
                    baseCharResults.appendChild(item);
                }
            });
            baseCharResults.style.display = baseCharResults.children.length > 0 ? 'block' : 'none';
        });

        // 使用 mousedown 事件代替 click 来处理搜索结果的选择，以避免与输入框的 focusout 事件发生竞态条件
        baseCharResults.addEventListener('mousedown', (e) => {
            // 阻止 mousedown 事件的默认行为（即导致输入框失焦），从而彻底消除竞态条件
            e.preventDefault(); 
            
            const target = e.target;
            if (target.classList.contains('result-item')) {
                const charId = target.dataset.charId;
                const char = characterMap.get(charId);
                if (char) {
                    baseCharSearchInput.value = target.textContent;
                    baseCharSearchInput.dataset.selectedId = charId;
                    baseCharResults.style.display = 'none';
                }
            }
        });

        // 当搜索框失焦时，延迟隐藏结果列表，以便响应点击事件
        baseCharSearchInput.addEventListener('focusout', () => {
            setTimeout(() => baseCharResults.style.display = 'none', 150);
        });

        // 3. 创建 "管理临时人物" 列表
        const manageSection = document.createElement('div');
        manageSection.className = 'char-management-section';
        manageSection.innerHTML = '<h4>管理已有临时人物</h4><div id="temp-char-list"></div>';
        avatarFormContainer.appendChild(manageSection);
        
        // 填充临时人物列表的函数
        const populateTempList = () => {
            const tempList = document.getElementById('temp-char-list');
            tempList.innerHTML = '';
            temporaryCharacters.forEach(char => {
                const baseChar = characterMap.get(char.baseId);
                const baseName = baseChar ? (baseChar.short_names['zh-cn'] || baseChar.names.en) : '未知';
                const item = document.createElement('div');
                item.className = 'temp-char-item';
                item.innerHTML = `
                    <span><strong>${char.name}</strong> (原型: ${baseName})</span>
                    <button class="delete-temp-char-btn" data-id="${char.id}">&times;</button>
                `;
                tempList.appendChild(item);
            });
        };
        populateTempList();
        
        // 4. 使用事件委托统一处理创建和删除事件
        avatarFormContainer.addEventListener('click', (e) => {
            const target = e.target;

            // 处理创建按钮点击
            if (target.id === 'create-temp-char-btn') {
                const baseCharSearchInput = document.getElementById('base-char-search-input');
                const tempCharNameInput = document.getElementById('temp-char-name-input');
                const baseId = baseCharSearchInput.dataset.selectedId;
                const name = tempCharNameInput.value.trim();

                if (!baseId) { 
                    alert('请先从搜索结果中选择一个原型角色'); 
                    return; 
                }
                if (!name) { 
                    alert('临时名称不能为空'); 
                    return; 
                }
                
                const newId = `temp_${Date.now()}`;
                const newTempChar = { id: newId, baseId: baseId, name: name };
                
                temporaryCharacters.push(newTempChar);
                characterMap.set(newId, { 
                    id: newId, 
                    baseId: baseId, 
                    isTemporary: true, 
                    short_names: { 'zh-cn': name }, 
                    names: { en: name }
                });
                
                updateBackend();
                populateTempList(); // 刷新列表

                tempCharNameInput.value = '';
                baseCharSearchInput.value = '';
                delete baseCharSearchInput.dataset.selectedId;
            }

            // 处理删除按钮点击
            if (target.classList.contains('delete-temp-char-btn')) {
                const idToDelete = target.dataset.id;
                const tempCharToDelete = temporaryCharacters.find(tc => tc.id === idToDelete);
                
                if (tempCharToDelete) {
                    showConfirm(`删除临时人物 "${tempCharToDelete.name}"？所有使用它的对话行将被重置回其原型角色。`, () => {
                        temporaryCharacters = temporaryCharacters.filter(c => c.id !== idToDelete);
                        characterMap.delete(idToDelete);
                        
                        if (tempCharToDelete) {
                            scriptData.forEach(line => {
                                if (line.characterId === idToDelete) {
                                    line.characterId = tempCharToDelete.baseId;
                                }
                            });
                        }
                        render();
                        updateBackend();
                        populateTempList(); // 刷新列表
                    });
                }
            }
        });
        
        // 5. 显示模态框并调整按钮状态
        avatarConfirmBtn.style.display = 'none'; // 隐藏主确认按钮
        avatarCancelBtn.textContent = '关闭';
        confirmModal.classList.add('modal-visible');
    }

    /**
     * 显示角色选择菜单
     * @param {HTMLElement} targetButton - 触发菜单的按钮元素
     * @param {number} lineIndex - 触发菜单的对话行索引
     */
    function showCharacterMenu(targetButton, lineIndex) {
        // 如果菜单已存在，则关闭它
        const existingMenu = document.querySelector('.character-menu'); 
        if (existingMenu) { 
            existingMenu.remove(); 
            return; 
        }

        const menu = document.createElement('div'); 
        menu.className = 'character-menu';

        // 1. "最近使用" 列表
        const charsInScript = scriptData.map(line => line.characterId);
        const usedCharIds = [...new Set(['me', 'narration', ...charsInScript])];
        if (usedCharIds.length > 0) {
            const recentTitle = document.createElement('div');
            recentTitle.className = 'recent-chars-title';
            recentTitle.textContent = '最近使用';
            menu.appendChild(recentTitle);
            
            usedCharIds.forEach(id => {
                const char = characterMap.get(id);
                if (char) {
                    const name = char.short_names['zh-cn'] || char.names['en'];
                    const item = document.createElement('div');
                    item.className = 'character-menu-item';
                    item.textContent = name;
                    item.dataset.charId = id;
                    item.style.backgroundColor = getColorForId(id);
                    menu.appendChild(item);
                }
            });
            menu.appendChild(document.createElement('hr'));
        }

        // 2. 搜索框和结果列表
        const searchInput = document.createElement('input'); 
        searchInput.type = 'text'; 
        searchInput.className = 'char-menu-search'; 
        searchInput.placeholder = '搜索全部角色...';
        
        const addCustomBtn = document.createElement('button');
        addCustomBtn.id = 'add-custom-char-btn';
        addCustomBtn.textContent = '添加自定义人物';
        addCustomBtn.style.display = 'none'; // 默认隐藏

        const listContainer = document.createElement('div'); 
        listContainer.className = 'char-menu-list';
        
        // 填充搜索结果列表的函数
        const populateList = (filter = '') => {
            listContainer.innerHTML = '';
            const characters = Array.from(characterMap.values())
                .filter(c => c.id !== 'me' && c.id !== 'narration')
                .sort((a, b) => (a.short_names['zh-cn'] || a.names['en']).localeCompare(b.short_names['zh-cn'] || b.names['en']));
            
            characters.forEach(char => {
                const name = char.short_names['zh-cn'] || char.names['en'];
                if (name && name.toLowerCase().includes(filter.toLowerCase())) {
                    const item = document.createElement('div'); 
                    item.className = 'character-menu-item'; 
                    item.textContent = name; 
                    item.dataset.charId = char.id; 
                    item.style.backgroundColor = getColorForId(char.id); 
                    listContainer.appendChild(item);
                }
            });
        };
        
        // 监听搜索框输入事件
        searchInput.addEventListener('input', () => {
            const filterText = searchInput.value.trim();
            if (filterText) {
                listContainer.style.display = 'block';
                populateList(filterText);
                // 如果搜索结果为空，则显示“添加自定义人物”按钮
                addCustomBtn.style.display = (listContainer.children.length === 0) ? 'block' : 'none';
            } else {
                listContainer.style.display = 'none';
                addCustomBtn.style.display = 'none';
            }
        });
        
        // 3. 组装并显示菜单
        menu.appendChild(addCustomBtn);
        menu.appendChild(searchInput); 
        menu.appendChild(listContainer); 
        document.body.appendChild(menu); 
        listContainer.style.display = 'none';
        
        // 4. 绑定菜单项点击事件
        menu.addEventListener('click', (e) => {
            const target = e.target;
            const menuItem = target.closest('.character-menu-item');
            if (menuItem) {
                const selectedId = menuItem.dataset.charId;
                if (selectedId) { 
                    scriptData[lineIndex].characterId = selectedId; 
                    render(); 
                    updateBackend(); 
                    menu.remove(); 
                }
            }
        });
        
        // 5. 绑定“添加自定义人物”按钮点击事件
        addCustomBtn.onclick = () => {
            const newName = searchInput.value.trim();
            if (!newName) return;

            // 检查是否与已有角色重名
            for (const char of characterMap.values()) {
                const name = char.short_names['zh-cn'] || char.names['en'];
                if (name === newName) {
                    alert('已存在同名角色！');
                    return;
                }
            }
            
            // 创建新的自定义角色对象
            const newId = `custom_${Date.now()}`;
            const newChar = { id: newId, name: newName };

            customCharacters.push(newChar);
            characterMap.set(newId, { 
                id: newId, 
                short_names: { 'zh-cn': newName }, 
                names: { en: newName }
            });

            scriptData[lineIndex].characterId = newId;
            render();
            updateBackend();
            menu.remove();
        };
        
        // 6. 定位菜单并自动聚焦
        const btnRect = targetButton.getBoundingClientRect(); 
        menu.style.display = 'block';
        menu.style.left = `${btnRect.left + window.scrollX}px`;
        menu.style.top = `${btnRect.bottom + window.scrollY + 5}px`;
        searchInput.focus();
        
        // 7. 添加全局事件监听器以关闭菜单
        const closeMenu = (e) => { 
            if (targetButton.contains(e.target)) return; 
            const menuElement = document.querySelector('.character-menu'); 
            if (menuElement && !menuElement.contains(e.target)) { 
                menuElement.remove(); 
                document.removeEventListener('click', closeMenu, true); 
                window.removeEventListener('keydown', keydownHandler, true); 
            } 
        };
        const keydownHandler = (e) => { 
            if (e.key === 'Escape') { 
                const menuElement = document.querySelector('.character-menu'); 
                if (menuElement) { 
                    menuElement.remove(); 
                    document.removeEventListener('click', closeMenu, true); 
                    window.removeEventListener('keydown', keydownHandler, true); 
                } 
            } 
        };
        setTimeout(() => { 
            document.addEventListener('click', closeMenu, true); 
            window.addEventListener('keydown', keydownHandler, true); 
        }, 0);
    }

    // --- SECTION: Event Listeners ---

    // 监听来自 VS Code 后端的消息
    window.addEventListener('message', (event) => {
        const message = event.data;
        switch(message.type) {
            case 'init':
                // 初始化 '我' 和 '旁白'
                characterMap.set('me', { id: 'me', short_names: { 'zh-cn': '我' }, names: { 'en': 'Me' } });
                characterMap.set('narration', { id: 'narration', short_names: { 'zh-cn': '旁白' }, names: { 'en': 'Narration' } });
                // 加载所有标准角色
                message.characterData.forEach(char => { characterMap.set(char.id, char); });

                try {
                    let docData = {};
                    // 如果文档为空，则使用默认的初始数据
                    if (!message.documentText || message.documentText.trim() === '') {
                        docData = { script: [{ characterId: 'me', line: '' }], customCharacters: [], temporaryCharacters: [] };
                    } else {
                        const parsed = JSON.parse(message.documentText);
                        // 兼容旧的只存数组的格式
                        if (Array.isArray(parsed)) {
                            docData = { script: parsed, customCharacters: [], temporaryCharacters: [] };
                        } else {
                            docData = parsed;
                        }
                    }

                    scriptData = docData.script || [];
                    customCharacters = docData.customCharacters || [];
                    temporaryCharacters = docData.temporaryCharacters || [];

                    // 将自定义和临时角色也加入 characterMap
                    customCharacters.forEach(char => characterMap.set(char.id, { id: char.id, isCustom: true, short_names: { 'zh-cn': char.name }, names: { en: char.name }}));
                    temporaryCharacters.forEach(char => characterMap.set(char.id, { id: char.id, baseId: char.baseId, isTemporary: true, short_names: { 'zh-cn': char.name }, names: { en: char.name }}));

                    render();
                } catch (e) {
                    scriptData = [{ characterId: 'me', line: '文件内容格式错误' }];
                    render();
                }
                break;
            case 'showAvatarModal': 
                showAvatarModal(message.payload); 
                break;
        }
    });

    // 通用确认模态框的按钮事件
    modalConfirmBtn.addEventListener('click', () => { 
        if (typeof confirmCallback === 'function') { 
            confirmCallback(); 
        } 
        hideConfirm(); 
    });
    modalCancelBtn.addEventListener('click', hideConfirm);

    // 头像设置模态框的按钮事件
    avatarCancelBtn.addEventListener('click', () => {
        // 恢复按钮的默认状态，以防是从角色管理模态框打开的
        avatarConfirmBtn.style.display = 'inline-block';
        avatarCancelBtn.textContent = '取消';
        hideAvatarModal();
    });

    avatarConfirmBtn.addEventListener('click', () => {
        const allInputs = avatarFormContainer.querySelectorAll('input');
        const finalAvatars = {};
        const customCharMappings = {};

        allInputs.forEach(input => {
            if (input.dataset.charType === 'normal') {
                finalAvatars[input.dataset.charId] = input.value;
            } else if (input.dataset.charType === 'custom') {
                const tempId = input.dataset.tempId;
                customCharMappings[tempId] = {
                    finalId: input.value.trim() || tempId, // 如果用户不填，就用临时ID作为最终ID
                    name: input.dataset.charName
                };
            }
        });

        // 发送最终的导出数据到后端
        vscode.postMessage({
            type: 'finalExport',
            payload: {
                script: scriptData,
                avatars: finalAvatars,
                customCharMappings: customCharMappings,
                temporaryCharacters: temporaryCharacters
            }
        });
        hideAvatarModal();
    });

    // 监听对话容器的右键菜单事件
    linesContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const lineElement = e.target.closest('.line');
        if (!lineElement) return;

        const lineIndex = parseInt(lineElement.dataset.index);
        
        // 移除已存在的菜单
        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) existingMenu.remove();
        
        // 创建新菜单
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.top = `${e.clientY + window.scrollY}px`;
        menu.style.left = `${e.clientX + window.scrollX}px`;
        
        const deleteItem = document.createElement('div');
        deleteItem.className = 'context-menu-item';
        deleteItem.textContent = '删除该行';
        deleteItem.onclick = () => { 
            deleteLine(lineIndex); 
            menu.remove(); 
        };
        menu.appendChild(deleteItem);
        document.body.appendChild(menu);
        
        // 添加全局点击事件以关闭菜单
        const closeMenu = () => { 
            menu.remove(); 
            document.removeEventListener('click', closeMenu); 
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    });

    // 监听对话容器的左键点击事件（事件委托）
    linesContainer.addEventListener('click', (e) => {
        const target = e.target;
        const lineElement = target.closest('.line');
        if (!lineElement) return;

        const lineIndex = parseInt(lineElement.dataset.index);

        if (target.closest('.character-btn')) { 
            showCharacterMenu(target, lineIndex); 
        } else if (target.closest('.insert-line-handle')) { 
            handleNewLine(lineIndex, false); 
        }
    });

    // 监听对话容器的输入事件（事件委托）
    linesContainer.addEventListener('input', (e) => { 
        if (e.target.classList.contains('line-input')) { 
            const index = parseInt(e.target.closest('.line').dataset.index); 
            scriptData[index].line = e.target.value; 
            updateBackend(); 
        } 
    });
    
    // 监听对话容器的键盘按下事件（事件委托）
    linesContainer.addEventListener('keydown', (e) => { 
        if (e.target.classList.contains('line-input') && e.key === 'Enter') { 
            e.preventDefault(); 
            const index = parseInt(e.target.closest('.line').dataset.index);
            // Shift + Enter 创建旁白行, Enter 创建普通行
            handleNewLine(index, e.shiftKey); 
        } 
    });

    // --- Drag and Drop Event Listeners ---
    linesContainer.addEventListener('dragstart', (e) => {
        // 只允许通过拖拽手柄启动拖拽
        if (e.target.classList.contains('drag-handle')) {
            const targetLine = e.target.closest('.line');
            if (targetLine) {
                draggedElement = targetLine;
                e.dataTransfer.effectAllowed = 'move';
                
                // 创建一个拖拽时的幽灵图像，避免浏览器默认行为
                const clone = targetLine.cloneNode(true);
                clone.style.width = `${targetLine.offsetWidth}px`;
                clone.style.position = 'absolute';
                clone.style.left = '-9999px';
                document.body.appendChild(clone);
                e.dataTransfer.setDragImage(clone, clone.offsetWidth / 2, clone.offsetHeight / 2);
                
                setTimeout(() => clone.remove(), 0);
                setTimeout(() => targetLine.classList.add('dragging'), 0);
            }
        } else {
            // 阻止从其他元素（如输入框）开始拖拽
            e.preventDefault();
        }
    });

    linesContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dropZoneTop = document.getElementById('drop-zone-top');
        const firstEl = linesContainer.firstElementChild;
        let isOverTopZone = false;

        // 判断鼠标是否在第一行元素的上半部分，如果是，则激活顶部拖放区域
        if (firstEl) { 
            const rect = firstEl.getBoundingClientRect(); 
            if (e.clientY < rect.top + (rect.height / 2)) { 
                isOverTopZone = true; 
            } 
        }

        // 移除所有悬停样式
        linesContainer.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        
        // 根据位置切换悬停样式
        dropZoneTop.classList.toggle('drag-over', isOverTopZone);
        const target = e.target.closest('.line');
        if (target && target !== draggedElement && !isOverTopZone) { 
            target.classList.add('drag-over'); 
        }
    });

    linesContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggedElement) return;
        
        const draggedIndex = parseInt(draggedElement.dataset.index);
        let dropIndex = -1;
        
        const dropZoneTop = document.getElementById('drop-zone-top');
        if (dropZoneTop.classList.contains('drag-over')) {
            dropIndex = 0;
        } else {
            const dropTarget = e.target.closest('.line');
            if (dropTarget) {
                dropIndex = parseInt(dropTarget.dataset.index);
            } else {
                // 如果拖到了容器底部，则认为是最后
                dropIndex = scriptData.length;
            }
        }
        
        if (dropIndex > -1) { 
            reorderLines(draggedIndex, dropIndex); 
        }
        
        // 清理拖拽状态
        draggedElement.classList.remove('dragging');
        dropZoneTop.classList.remove('drag-over');
        linesContainer.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        draggedElement = null;
    });

    linesContainer.addEventListener('dragend', () => {
        // 在拖拽结束时（无论是否成功 drop），都清理所有状态
        if (draggedElement) { 
            draggedElement.classList.remove('dragging'); 
        }
        document.getElementById('drop-zone-top').classList.remove('drag-over');
        linesContainer.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        draggedElement = null;
    });
    
    // --- Control Button Event Listeners ---

    document.getElementById('manage-chars-btn').addEventListener('click', showCharacterManagementModal);
    
    exportBtn.addEventListener('click', () => {
        // 1. 找出剧本中所有使用到的角色ID
        const usedCharIds = [...new Set(scriptData.map(line => line.characterId))];
        
        const customChars = [];
        const charForAvatarSetup = new Map(); // 使用 Map 根据原型ID去重，确保每个原型只设置一次头像

        usedCharIds.forEach(id => {
            if (id === 'me' || id === 'narration') return;

            const char = characterMap.get(id);
            if (!char) return;
            
            // 2. 分类处理：自定义角色和普通/临时角色
            if (char.isCustom) {
                customChars.push({ id, name: char.short_names['zh-cn'] });
            } else {
                // 如果是临时人物，获取其原型ID；否则就是它本身
                const baseId = char.isTemporary ? char.baseId : id;
                
                // 如果这个原型角色还没被添加过，就将其信息加入待设置列表
                if (!charForAvatarSetup.has(baseId)) {
                    const baseChar = characterMap.get(baseId);
                    if (baseChar) {
                        charForAvatarSetup.set(baseId, {
                            id: baseId,
                            name: baseChar.short_names['zh-cn'] || baseChar.names['en'],
                            defaultImg: (baseChar.images && baseChar.images.length > 0) ? baseChar.images[0] : ''
                        });
                    }
                }
            }
        });

        const normalChars = Array.from(charForAvatarSetup.values());
        
        // 3. 根据角色情况决定是直接导出还是弹出设置框
        if (normalChars.length === 0 && customChars.length === 0) {
            // 如果没有需要设置的角色，直接发送导出请求
            vscode.postMessage({ 
                type: 'finalExport', 
                payload: { 
                    script: scriptData, 
                    avatars: {}, 
                    customCharMappings: {}, 
                    temporaryCharacters: temporaryCharacters 
                } 
            });
        } else {
            // 否则，请求后端显示头像/UID设置模态框
            vscode.postMessage({ 
                type: 'requestExport', 
                payload: { normalChars, customChars } 
            });
        }
    });

    // --- SECTION: Initial Call ---
    
    // Webview加载完成后，通知后端已准备好接收数据
    vscode.postMessage({ type: 'ready' });

}());