// media/main.js
(function () {
    // --- SECTION: State & Initialization ---
    const vscode = acquireVsCodeApi();
    
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
    
    let scriptData = [];
    let customCharacters = [];
    let temporaryCharacters = [];
    let characterMap = new Map();
    let confirmCallback = null;
    let draggedElement = null;

    // --- SECTION: Core UI & Rendering ---
    function getColorForId(id) {
        if (id === 'me') { return 'hsl(30, 40%, 45%)'; }
        if (id === 'narration') { return 'hsl(170, 40%, 40%)'; }
        let hash = 0;
        for (let i = 0; i < id.length; i++) { hash = id.charCodeAt(i) + ((hash << 5) - hash); }
        const h = hash % 360;
        const s = 40;
        const l = 35;
        return `hsl(${h}, ${s}%, ${l}%)`;
    }

    function render() {
        if (!linesContainer) return;

        if (!document.getElementById('drop-zone-top')) {
            const dropZone = document.createElement('div');
            dropZone.id = 'drop-zone-top';
            linesContainer.before(dropZone);
        }

        while (linesContainer.children.length > scriptData.length) {
            linesContainer.removeChild(linesContainer.lastChild);
        }
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

        scriptData.forEach((lineData, index) => {
            const lineEl = linesContainer.children[index];
            lineEl.dataset.index = index;
            lineEl.classList.remove('line-type-me', 'line-type-narration');
            if (lineData.characterId === 'me') { lineEl.classList.add('line-type-me'); } 
            else if (lineData.characterId === 'narration') { lineEl.classList.add('line-type-narration'); }
            const character = characterMap.get(lineData.characterId);
            const displayName = character?.short_names?.['zh-cn'] || character?.names?.['en'] || '未知角色';
            const charBtn = lineEl.querySelector('.character-btn');
            charBtn.textContent = displayName;
            charBtn.style.backgroundColor = getColorForId(lineData.characterId);
            const lineInput = lineEl.querySelector('.line-input');
            if (lineInput.value !== lineData.line) {
                lineInput.value = lineData.line;
            }
        });
    }

    function updateBackend() {
        vscode.postMessage({ type: 'updateText', payload: { script: scriptData, customCharacters: customCharacters, temporaryCharacters: temporaryCharacters } });
    }

    // --- SECTION: Core Actions ---
    function handleNewLine(index, useNarration) {
        const currentCharacterId = scriptData[index]?.characterId || 'me';
        const newCharacterId = useNarration ? 'narration' : currentCharacterId;
        const newLine = { characterId: newCharacterId, line: '' };
        scriptData.splice(index + 1, 0, newLine);
        render();
        const nextInput = document.querySelector(`.line[data-index="${index + 1}"] .line-input`);
        if (nextInput) { nextInput.focus(); }
        updateBackend();
    }

    function deleteLine(index) {
        if (scriptData.length > 1) {
            scriptData.splice(index, 1);
            render();
            updateBackend();
        } else {
            alert("至少保留一行对话。");
        }
    }
    
    function reorderLines(draggedIdx, dropIdx) {
        if (draggedIdx === dropIdx) return;
        const [draggedItem] = scriptData.splice(draggedIdx, 1);
        scriptData.splice(dropIdx, 0, draggedItem);
        render();
        updateBackend();
    }

    // --- SECTION: UI Components (Modals & Menu) ---
    function showConfirm(message, onConfirm) {
        modalContentAvatar.style.display = 'none';
        modalContentConfirm.style.display = 'block';
        modalMessage.textContent = message;
        confirmCallback = onConfirm;
        confirmModal.classList.add('modal-visible');
    }
    function hideConfirm() {
        confirmModal.classList.remove('modal-visible');
        confirmCallback = null;
    }
    function showAvatarModal(payload) {
        const { normalChars, customChars } = payload;

        modalContentConfirm.style.display = 'none';
        modalContentAvatar.style.display = 'block';

        avatarFormContainer.innerHTML = ''; // 清空旧表单

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
    function hideAvatarModal() {
        confirmModal.classList.remove('modal-visible');
        setTimeout(() => {
            modalContentConfirm.style.display = 'block';
            modalContentAvatar.style.display = 'none';
        }, 200);
    }
    
    function showCharacterManagementModal() {
        modalContentConfirm.style.display = 'none';
        modalContentAvatar.style.display = 'block';
        avatarFormContainer.innerHTML = ''; // 清空
        
        // 1. 创建 "添加临时人物" 表单
        const createSection = document.createElement('div');
        createSection.className = 'char-management-section';
        // 【修改】将 select 替换为 input 和 results 容器
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

        // 【新增】处理搜索框逻辑
        const baseCharSearchInput = document.getElementById('base-char-search-input');
        const baseCharResults = document.getElementById('base-char-results');

        baseCharSearchInput.addEventListener('input', () => {
            const filter = baseCharSearchInput.value.trim().toLowerCase();
            baseCharResults.innerHTML = '';

            if (!filter) {
                baseCharResults.style.display = 'none';
                return;
            }

            const characters = Array.from(characterMap.values())
                .filter(c => !c.isCustom && !c.isTemporary && c.id !== 'me' && c.id !== 'narration');
            
            characters.forEach(char => {
                const name = char.short_names['zh-cn'] || char.names.en;
                if (name.toLowerCase().includes(filter)) {
                    const item = document.createElement('div');
                    item.className = 'result-item';
                    item.textContent = name;
                    item.dataset.charId = char.id;
                    item.onclick = () => {
                        baseCharSearchInput.value = name;
                        baseCharSearchInput.dataset.selectedId = char.id; // 存储ID
                        baseCharResults.style.display = 'none';
                    };
                    baseCharResults.appendChild(item);
                }
            });
            baseCharResults.style.display = baseCharResults.children.length > 0 ? 'block' : 'none';
        });

        // 点击外部关闭结果列表
        baseCharSearchInput.addEventListener('focusout', () => {
            // 延迟关闭，以便能响应 item 的 click 事件
            setTimeout(() => baseCharResults.style.display = 'none', 150);
        });

        // 2. 创建 "管理临时人物" 列表 (逻辑不变)
        const manageSection = document.createElement('div');
        manageSection.className = 'char-management-section';
        manageSection.innerHTML = '<h4>管理已有临时人物</h4><div id="temp-char-list"></div>';
        avatarFormContainer.appendChild(manageSection);

        const populateTempList = () => {
            const tempList = document.getElementById('temp-char-list');
            tempList.innerHTML = '';
            temporaryCharacters.forEach(char => {
                const baseChar = characterMap.get(char.baseId);
                const baseName = baseChar ? (baseChar.short_names['zh-cn'] || baseChar.names.en) : '未知';
                const item = document.createElement('div');
                item.className = 'temp-char-item';
                item.innerHTML = `<span><strong>${char.name}</strong> (原型: ${baseName})</span><button class="delete-temp-char-btn" data-id="${char.id}">&times;</button>`;
                tempList.appendChild(item);
            });
        };
        populateTempList();
        
        // 3. 绑定事件
        document.getElementById('create-temp-char-btn').onclick = () => {
            // 【修改】从新的搜索框获取 baseId
            const baseId = baseCharSearchInput.dataset.selectedId;
            const name = document.getElementById('temp-char-name-input').value.trim();

            if (!baseId) { alert('请先从搜索结果中选择一个原型角色'); return; }
            if (!name) { alert('临时名称不能为空'); return; }

            const newId = `temp_${Date.now()}`;
            const newTempChar = { id: newId, baseId: baseId, name: name };
            
            temporaryCharacters.push(newTempChar);
            characterMap.set(newId, { id: newId, baseId: baseId, isTemporary: true, short_names: { 'zh-cn': name }, names: { en: name }});
            
            updateBackend();
            populateTempList(); // 刷新列表
            document.getElementById('temp-char-name-input').value = '';
            baseCharSearchInput.value = '';
            delete baseCharSearchInput.dataset.selectedId;
        };

        document.getElementById('temp-char-list').onclick = (e) => {
            if (e.target.classList.contains('delete-temp-char-btn')) {
                const idToDelete = e.target.dataset.id;
                const tempCharToDelete = temporaryCharacters.find(tc => tc.id === idToDelete);

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
                    populateTempList();
                });
            }
        };
        
        // 4. 显示模态框
        avatarConfirmBtn.style.display = 'none'; // 隐藏主确认按钮
        avatarCancelBtn.textContent = '关闭';
        confirmModal.classList.add('modal-visible');
    }

    // 找到 avatarCancelBtn 的监听器，并修改其行为
    avatarCancelBtn.addEventListener('click', () => {
        // 恢复按钮的默认状态
        avatarConfirmBtn.style.display = 'inline-block';
        avatarCancelBtn.textContent = '取消';
        hideAvatarModal();
    });
    function showCharacterMenu(targetButton, lineIndex) {
        const existingMenu = document.querySelector('.character-menu'); if (existingMenu) { existingMenu.remove(); return; }
        const menu = document.createElement('div'); menu.className = 'character-menu';
        const charsInScript = scriptData.map(line => line.characterId);
        const usedCharIds = [...new Set(['me', 'narration', ...charsInScript])];
        if (usedCharIds.length > 0) {
            const recentTitle = document.createElement('div'); recentTitle.className = 'recent-chars-title'; recentTitle.textContent = '最近使用'; menu.appendChild(recentTitle);
            usedCharIds.forEach(id => {
                const char = characterMap.get(id);
                if (char) {
                    const name = char.short_names['zh-cn'] || char.names['en'];
                    const item = document.createElement('div'); item.className = 'character-menu-item'; item.textContent = name; item.dataset.charId = id; item.style.backgroundColor = getColorForId(id); menu.appendChild(item);
                }
            });
            menu.appendChild(document.createElement('hr'));
        }
        const searchInput = document.createElement('input'); searchInput.type = 'text'; searchInput.className = 'char-menu-search'; searchInput.placeholder = '搜索全部角色...';
        const addCustomBtn = document.createElement('button');
        addCustomBtn.id = 'add-custom-char-btn';
        addCustomBtn.textContent = '添加自定义人物';
        addCustomBtn.style.display = 'none'; // 默认隐藏

        const listContainer = document.createElement('div'); listContainer.className = 'char-menu-list';
        const populateList = (filter = '') => {
            listContainer.innerHTML = '';
            const characters = Array.from(characterMap.values()).filter(c => c.id !== 'me' && c.id !== 'narration').sort((a, b) => (a.short_names['zh-cn'] || a.names['en']).localeCompare(b.short_names['zh-cn'] || b.names['en']));
            characters.forEach(char => {
                const name = char.short_names['zh-cn'] || char.names['en'];
                if (name && name.toLowerCase().includes(filter.toLowerCase())) {
                    const item = document.createElement('div'); item.className = 'character-menu-item'; item.textContent = name; item.dataset.charId = char.id; item.style.backgroundColor = getColorForId(char.id); listContainer.appendChild(item);
                }
            });
        };
        searchInput.addEventListener('input', () => {
            const filterText = searchInput.value.trim();
            if (filterText) {
                listContainer.style.display = 'block';
                populateList(filterText);
                // 如果搜索结果为空，且输入了内容，则显示“添加”按钮
                addCustomBtn.style.display = (listContainer.children.length === 0) ? 'block' : 'none';
            } else {
                listContainer.style.display = 'none';
                addCustomBtn.style.display = 'none';
            }
        });
        menu.appendChild(addCustomBtn);
        menu.appendChild(searchInput); menu.appendChild(listContainer); document.body.appendChild(menu); listContainer.style.display = 'none';
        menu.addEventListener('click', (e) => {
                    const target = e.target;
                    const menuItem = target.closest('.character-menu-item');
                    if (menuItem) {
                        const selectedId = menuItem.dataset.charId;
                        if (selectedId) { scriptData[lineIndex].characterId = selectedId; render(); updateBackend(); menu.remove(); }
                    }
                });
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

            const newId = `custom_${Date.now()}`;
            const newChar = { id: newId, name: newName };

            customCharacters.push(newChar);
            characterMap.set(newId, { id: newId, short_names: { 'zh-cn': newName }, names: { en: newName }});

            scriptData[lineIndex].characterId = newId;
            render();
            updateBackend();
            menu.remove();
        };
        const btnRect = targetButton.getBoundingClientRect(); 
        menu.style.display = 'block';
        menu.style.left = `${btnRect.left + window.scrollX}px`;
        menu.style.top = `${btnRect.bottom + window.scrollY + 5}px`;
        searchInput.focus();
        const closeMenu = (e) => { if (targetButton.contains(e.target)) return; const menuElement = document.querySelector('.character-menu'); if (menuElement && !menuElement.contains(e.target)) { menuElement.remove(); document.removeEventListener('click', closeMenu, true); window.removeEventListener('keydown', keydownHandler, true); } };
        const keydownHandler = (e) => { if (e.key === 'Escape') { const menuElement = document.querySelector('.character-menu'); if (menuElement) { menuElement.remove(); document.removeEventListener('click', closeMenu, true); window.removeEventListener('keydown', keydownHandler, true); } } };
        setTimeout(() => { document.addEventListener('click', closeMenu, true); window.addEventListener('keydown', keydownHandler, true); }, 0);
    }

    // --- SECTION: Event Listeners ---
    window.addEventListener('message', (event) => {
        const message = event.data;
        switch(message.type) {
            case 'init':
            characterMap.set('me', { id: 'me', short_names: { 'zh-cn': '我' }, names: { 'en': 'Me' } });
            characterMap.set('narration', { id: 'narration', short_names: { 'zh-cn': '旁白' }, names: { 'en': 'Narration' } });
            message.characterData.forEach(char => { characterMap.set(char.id, char); });

            try {
                let docData = {};
                if (!message.documentText || message.documentText.trim() === '') {
                    docData = { script: [{ characterId: 'me', line: '' }], customCharacters: [], temporaryCharacters: [] };
                } else {
                    const parsed = JSON.parse(message.documentText);
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
            case 'showAvatarModal': showAvatarModal(message.payload); break;
        }
    });

    modalConfirmBtn.addEventListener('click', () => { if (typeof confirmCallback === 'function') { confirmCallback(); } hideConfirm(); });
    modalCancelBtn.addEventListener('click', hideConfirm);

    avatarCancelBtn.addEventListener('click', hideAvatarModal);
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
                    finalId: input.value.trim() || tempId, // 如果用户不填，就用临时ID
                    name: input.dataset.charName
                };
            }
        });

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

    linesContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const lineElement = e.target.closest('.line');
        if (!lineElement) return;
        const lineIndex = parseInt(lineElement.dataset.index);
        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) existingMenu.remove();
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.top = `${e.clientY + window.scrollY}px`;
        menu.style.left = `${e.clientX + window.scrollX}px`;
        const deleteItem = document.createElement('div');
        deleteItem.className = 'context-menu-item';
        deleteItem.textContent = '删除该行';
        deleteItem.onclick = () => { deleteLine(lineIndex); menu.remove(); };
        menu.appendChild(deleteItem);
        document.body.appendChild(menu);
        const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    });

    linesContainer.addEventListener('click', (e) => {
        const target = e.target;
        const lineElement = target.closest('.line');
        if (!lineElement) return;
        const lineIndex = parseInt(lineElement.dataset.index);
        if (target.closest('.character-btn')) { showCharacterMenu(target, lineIndex); }
        else if (target.closest('.insert-line-handle')) { handleNewLine(lineIndex, false); }
    });

    linesContainer.addEventListener('input', (e) => { if (e.target.classList.contains('line-input')) { const index = parseInt(e.target.closest('.line').dataset.index); scriptData[index].line = e.target.value; updateBackend(); } });
    linesContainer.addEventListener('keydown', (e) => { if (e.target.classList.contains('line-input') && e.key === 'Enter') { e.preventDefault(); const index = parseInt(e.target.closest('.line').dataset.index); handleNewLine(index, e.shiftKey); } });

    linesContainer.addEventListener('dragstart', (e) => {
        // 只在拖动 handle 时启动
        if (e.target.classList.contains('drag-handle')) {
            const targetLine = e.target.closest('.line');
            if (targetLine) {
                draggedElement = targetLine;
                e.dataTransfer.effectAllowed = 'move';

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
            // 如果拖动的不是 handle，则阻止拖拽
            e.preventDefault();
        }
    });

    linesContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dropZoneTop = document.getElementById('drop-zone-top');
        const firstEl = linesContainer.firstElementChild;
        let isOverTopZone = false;
        if (firstEl) { const rect = firstEl.getBoundingClientRect(); if (e.clientY < rect.top + (rect.height / 2)) { isOverTopZone = true; } }
        linesContainer.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        dropZoneTop.classList.toggle('drag-over', isOverTopZone);
        const target = e.target.closest('.line');
        if (target && target !== draggedElement && !isOverTopZone) { target.classList.add('drag-over'); }
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
                dropIndex = scriptData.length;
            }
        }
        if (dropIndex > -1) { reorderLines(draggedIndex, dropIndex); }
        draggedElement.classList.remove('dragging');
        dropZoneTop.classList.remove('drag-over');
        linesContainer.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        draggedElement = null;
    });

    linesContainer.addEventListener('dragend', () => {
        if (draggedElement) { draggedElement.classList.remove('dragging'); }
        document.getElementById('drop-zone-top').classList.remove('drag-over');
        linesContainer.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        draggedElement = null;
    });
    
    // 【修正】将导出按钮的事件监听器放回正确的位置
    // 【新增】为“管理角色”按钮绑定点击事件
    document.getElementById('manage-chars-btn').addEventListener('click', showCharacterManagementModal);
    exportBtn.addEventListener('click', () => {
        const usedCharIds = [...new Set(scriptData.map(line => line.characterId))];
        
        const customChars = [];
        const charForAvatarSetup = new Map(); // 使用 Map 来根据原型ID去重

        usedCharIds.forEach(id => {
            if (id === 'me' || id === 'narration') return;

            const char = characterMap.get(id);
            if (!char) return;

            if (char.isCustom) {
                customChars.push({ id, name: char.short_names['zh-cn'] });
            } else {
                // 如果是临时人物，获取其原型ID；否则就是它本身
                const baseId = char.isTemporary ? char.baseId : id;
                
                // 如果这个原型角色还没被添加过，就添加它
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

        if (normalChars.length === 0 && customChars.length === 0) {
            vscode.postMessage({ type: 'finalExport', payload: { script: scriptData, avatars: {}, customCharMappings: {}, temporaryCharacters: temporaryCharacters } });
        } else {
            vscode.postMessage({ type: 'requestExport', payload: { normalChars, customChars } });
        }
    });

    // --- SECTION: Initial Call ---
    vscode.postMessage({ type: 'ready' });

}());