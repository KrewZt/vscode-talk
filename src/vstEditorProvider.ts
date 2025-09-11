// src/vstEditorProvider.ts
import * as vscode from 'vscode';

export class VstEditorProvider implements vscode.CustomTextEditorProvider {

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new VstEditorProvider(context);
        return vscode.window.registerCustomEditorProvider('vscode-talk.vstEditor', provider, {
            webviewOptions: {
                retainContextWhenHidden: true,
            },
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
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
            ]
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

    private updateTextDocument(document: vscode.TextDocument, data: any) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(data, null, 2));
        vscode.workspace.applyEdit(edit);
    }
    
    private async exportToJson(document: vscode.TextDocument, data: { script: any[], avatars: { [key: string]: string } }) {
        try {
            const { script, avatars } = data;
            const chat = script.map(line => {
                const isMe = line.characterId === 'me';
                const isNarration = line.characterId === 'narration';
                const yuzutalk = { type: isNarration ? "NARRATION" : "TEXT", avatarState: "AUTO", nameOverride: "" };
                if (isMe || isNarration) {
                    return { is_breaking: false, content: line.line, yuzutalk, arknights: { type: "TEXT" } };
                } else {
                    return { char_id: "ba-" + line.characterId, img: avatars[line.characterId] || "", is_breaking: false, content: line.line, yuzutalk, arknights: { type: "TEXT" } };
                }
            });
            const chars = Object.entries(avatars).map(([id, img]) => ({ id, img }));
            const exportObject = { chat, chars, custom_chars: [] };
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
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
        const resetCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'reset.css'));
        const stylesCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${resetCssUri}" rel="stylesheet">
                <link href="${stylesCssUri}" rel="stylesheet">
                <title>VST Editor</title>
            </head>
            <body>
                <div id="controls">
                    <button id="export-btn" class="control-btn" title="导出为兼容格式的JSON文件">导出</button>
                </div>
                <div id="lines-container"></div>
                <div id="confirm-modal" class="modal-overlay">
                    <div class="modal-box">
                        <div id="modal-content-confirm">
                            <p class="modal-message" id="modal-message">确定要执行此操作吗？</p>
                            <div class="modal-buttons">
                                <button id="modal-cancel-btn">取消</button>
                                <button id="modal-confirm-btn">确定</button>
                            </div>
                        </div>
                        <div id="modal-content-avatar" style="display: none;">
                            <p class="modal-message">设置角色头像</p>
                            <div id="avatar-modal-form-container" class="avatar-modal-form"></div>
                            <div class="modal-buttons">
                                <button id="avatar-cancel-btn">取消</button>
                                <button id="avatar-confirm-btn">确认并导出</button>
                            </div>
                        </div>
                    </div>
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
    return text;
}