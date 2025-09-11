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
            lineEl.draggable = true;
            lineEl.innerHTML = `
                <button class="character-btn" title="点击切换人物"></button>
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

    function updateBackend() { vscode.postMessage({ type: 'updateText', payload: scriptData }); }

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
    function showAvatarModal(charsToSet) {
        modalContentConfirm.style.display = 'none';
        modalContentAvatar.style.display = 'block';
        avatarFormContainer.innerHTML = '';
        charsToSet.forEach(char => {
            const label = document.createElement('label');
            label.setAttribute('for', `avatar-input-${char.id}`);
            label.textContent = char.name;
            const input = document.createElement('input');
            input.type = 'text';
            input.id = `avatar-input-${char.id}`;
            input.dataset.charId = char.id;
            input.value = char.defaultImg;
            avatarFormContainer.appendChild(label);
            avatarFormContainer.appendChild(input);
        });
        confirmModal.classList.add('modal-visible');
    }
    function hideAvatarModal() {
        confirmModal.classList.remove('modal-visible');
        setTimeout(() => {
            modalContentConfirm.style.display = 'block';
            modalContentAvatar.style.display = 'none';
        }, 200);
    }
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
        searchInput.addEventListener('input', () => { const filterText = searchInput.value.trim(); listContainer.style.display = filterText ? 'block' : 'none'; populateList(filterText); });
        menu.appendChild(searchInput); menu.appendChild(listContainer); document.body.appendChild(menu); listContainer.style.display = 'none';
        menu.addEventListener('click', (e) => {
            const target = e.target;
            const menuItem = target.closest('.character-menu-item');
            if (menuItem) {
                const selectedId = menuItem.dataset.charId;
                if (selectedId) { scriptData[lineIndex].characterId = selectedId; render(); updateBackend(); menu.remove(); }
            }
        });
        const btnRect = targetButton.getBoundingClientRect(); menu.style.display = 'block'; menu.style.left = `${btnRect.left}px`; menu.style.top = `${btnRect.bottom + 5}px`; searchInput.focus();
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
                    if (!message.documentText || message.documentText.trim() === '') { scriptData = [{ characterId: 'me', line: '' }]; }
                    else { scriptData = JSON.parse(message.documentText); }
                    render();
                } catch (e) { scriptData = [{ characterId: 'me', line: '文件内容格式错误' }]; render(); }
                break;
            case 'showAvatarModal': showAvatarModal(message.payload); break;
        }
    });

    modalConfirmBtn.addEventListener('click', () => { if (typeof confirmCallback === 'function') { confirmCallback(); } hideConfirm(); });
    modalCancelBtn.addEventListener('click', hideConfirm);

    avatarCancelBtn.addEventListener('click', hideAvatarModal);
    avatarConfirmBtn.addEventListener('click', () => {
        const avatarInputs = avatarFormContainer.querySelectorAll('input');
        const finalAvatars = {};
        avatarInputs.forEach(input => { finalAvatars[input.dataset.charId] = input.value; });
        vscode.postMessage({ type: 'finalExport', payload: { script: scriptData, avatars: finalAvatars } });
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
        menu.style.top = `${e.clientY}px`;
        menu.style.left = `${e.clientX}px`;
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
        const target = e.target.closest('.line');
        if (target) {
            draggedElement = target;
            e.dataTransfer.effectAllowed = 'move';
            const clone = target.cloneNode(true);
            clone.style.width = `${target.offsetWidth}px`;
            clone.style.position = 'absolute';
            clone.style.left = '-9999px';
            document.body.appendChild(clone);
            e.dataTransfer.setDragImage(clone, 0, clone.offsetHeight / 2);
            setTimeout(() => clone.remove(), 0);
            setTimeout(() => target.classList.add('dragging'), 0);
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
    exportBtn.addEventListener('click', () => {
        const usedCharIds = [...new Set(scriptData.map(line => line.characterId))].filter(id => id !== 'me' && id !== 'narration');
        const charsToSet = usedCharIds.map(id => {
            const char = characterMap.get(id);
            return {
                id: id,
                name: char.short_names['zh-cn'] || char.names['en'],
                defaultImg: (char.images && char.images.length > 0) ? char.images[0] : ''
            };
        });
        if (charsToSet.length === 0) {
            vscode.postMessage({ type: 'finalExport', payload: { script: scriptData, avatars: {} } });
        } else {
            vscode.postMessage({ type: 'requestExport', payload: charsToSet });
        }
    });

    // --- SECTION: Initial Call ---
    vscode.postMessage({ type: 'ready' });

}());