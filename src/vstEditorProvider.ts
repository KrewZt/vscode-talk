// src/vstEditorProvider.ts
import * as vscode from 'vscode';

export class VstEditorProvider implements vscode.CustomTextEditorProvider {
    // ... register 和 constructor 不变 ...
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new VstEditorProvider(context);
        return vscode.window.registerCustomEditorProvider('vscode-talk.vstEditor', provider, {
            webviewOptions: { retainContextWhenHidden: true, },
        });
    }

    constructor(private readonly context: vscode.ExtensionContext) { }


    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
        
        const characterDataUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'char.json');
        const characterDataBuffer = await vscode.workspace.fs.readFile(characterDataUri);
        const characterData = JSON.parse(characterDataBuffer.toString());

        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'updateText': this.updateTextDocument(document, e.payload); return;
                case 'requestExport': webviewPanel.webview.postMessage({ type: 'showAvatarModal', payload: e.payload }); return;
                case 'finalExport': this.exportToJson(document, e.payload); return;
                case 'ready': webviewPanel.webview.postMessage({ type: 'init', documentText: document.getText(), characterData: characterData, }); return;
            }
        });
    }

    private updateTextDocument(document: vscode.TextDocument, data: { script: any[], customCharacters: any[], temporaryCharacters: any[] }) {
        // 【修改】现在保存的是一个对象，而不再是数组
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(data, null, 2)
        );
        vscode.workspace.applyEdit(edit);
    }
    
    private async exportToJson(document: vscode.TextDocument, data: { script: any[], avatars: { [key: string]: string }, customCharMappings: { [key: string]: { finalId: string, name: string } }, temporaryCharacters: any[] }) {
        try {
            const { script, avatars, customCharMappings, temporaryCharacters } = data;

            // 创建一个 临时ID -> 临时角色定义 的映射，方便查找
            const tempCharMap = new Map(temporaryCharacters.map(char => [char.id, char]));

            /**
             * 【新增】辅助函数：获取任意角色ID的原型ID
             * @param charId 角色ID（临时的、自定义的或普通的）
             * @returns {string} 该角色的原型ID
             */
            const getBaseId = (charId: string): string => {
                if (charId.startsWith('temp_')) {
                    return tempCharMap.get(charId)?.baseId || charId;
                }
                // 对于普通角色、自定义角色、"me"、"narration"，其自身就是原型
                return charId;
            };
            
            // 1. 构建 "chat" 列表
            const chat = script.map((line, index) => {
                const currentId = line.characterId;
                const isMe = currentId === 'me';
                const isNarration = currentId === 'narration';
                
                let avatarState = "AUTO";

                // 【核心修正】判断是否需要将 avatarState 设为 "SHOW"
                if (index > 0) {
                    const previousId = script[index - 1].characterId;
                    // 排除 "我" 和 "旁白" 的情况
                    if (currentId !== 'me' && currentId !== 'narration' && previousId !== 'me' && previousId !== 'narration') {
                        const currentBaseId = getBaseId(currentId);
                        const previousBaseId = getBaseId(previousId);

                        // 如果原型ID相同，但具体ID不同（例如 亚子 -> 亚子A），则强制显示
                        if (currentBaseId === previousBaseId && currentId !== previousId) {
                            avatarState = "SHOW";
                        }
                    }
                }

                const yuzutalk = { 
                    type: isNarration ? "NARRATION" : "TEXT", 
                    avatarState: avatarState, // 使用我们计算出的 state
                    nameOverride: "" 
                };

                if (isMe || isNarration) {
                    return { is_breaking: false, content: line.line, yuzutalk, arknights: { type: "TEXT" } };
                } 
                
                const isCustom = currentId.startsWith('custom_');
                const isTemporary = currentId.startsWith('temp_');

                if (isCustom) {
                    const finalId = customCharMappings[currentId]?.finalId || currentId;
                    return { char_id: finalId, img: "uploaded", is_breaking: false, content: line.line, yuzutalk, arknights: { type: "TEXT" } };
                }

                let baseId = currentId;
                if (isTemporary) {
                    const tempChar = tempCharMap.get(currentId);
                    if (tempChar) {
                        baseId = tempChar.baseId;
                        yuzutalk.nameOverride = tempChar.name;
                    }
                }
                
                return {
                    char_id: `ba-${baseId}`,
                    img: avatars[baseId] || "",
                    is_breaking: false,
                    content: line.line,
                    yuzutalk,
                    arknights: { type: "TEXT" }
                };
            });

            // 2. 构建 "chars" 列表 (逻辑不变)
            const normalCharsList = Object.entries(avatars).map(([id, img]) => ({ char_id: `ba-${id}`, img }));
            const customCharsList = Object.values(customCharMappings).map((mapping: any) => ({ char_id: mapping.finalId, img: "uploaded" }));
            const chars = [...normalCharsList, ...customCharsList];
            
            // 3. 构建 "custom_chars" 列表 (逻辑不变)
            const custom_chars = Object.values(customCharMappings).map((mapping: any) => ({ char_id: mapping.finalId, img: "", name: mapping.name }));

            const exportObject = { chat, chars, custom_chars };

            const saveUri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(document.uri.fsPath.replace('.vst', '.export.json')), filters: { 'JSON Files': ['json'] } });

            if (saveUri) {
                const jsonContent = JSON.stringify(exportObject, null, 2);
                await vscode.workspace.fs.writeFile(saveUri, Buffer.from(jsonContent, 'utf8'));
                vscode.window.showInformationMessage(`剧本已成功导出到: ${saveUri.fsPath}`);
            }
        } catch(e: any) {
            vscode.window.showErrorMessage(`导出失败: ${e.message}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // ... 此函数内容无变化 ...
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
        const resetCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'reset.css'));
        const stylesCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link href="${resetCssUri}" rel="stylesheet"><link href="${stylesCssUri}" rel="stylesheet"><title>VST Editor</title></head><body>
        <div id="controls">
            <button id="manage-chars-btn" class="control-btn" title="管理临时或自定义角色">管理角色</button>
            <button id="export-btn" class="control-btn" title="导出为兼容格式的JSON文件">导出</button>
        </div>
        <div id="lines-container"></div>
        <div id="confirm-modal" class="modal-overlay"><div class="modal-box"><div id="modal-content-confirm"><p class="modal-message" id="modal-message">确定要执行此操作吗？</p><div class="modal-buttons"><button id="modal-cancel-btn">取消</button><button id="modal-confirm-btn">确定</button></div></div><div id="modal-content-avatar" style="display: none;"><p class="modal-message">导出设置</p><div id="avatar-modal-form-container" class="avatar-modal-form"></div><div class="modal-buttons"><button id="avatar-cancel-btn">取消</button><button id="avatar-confirm-btn">确认并导出</button></div></div></div></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
    return text;
}