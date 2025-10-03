// src/vstEditorProvider.ts
import * as vscode from 'vscode';

/**
 * Provides the custom editor for '.vst' files.
 */
export class VstEditorProvider implements vscode.CustomTextEditorProvider {

    /**
     * Registers the custom editor provider.
     * @param context The extension context.
     * @returns A disposable that unregisters the provider.
     */
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new VstEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(
            'vscode-talk.vstEditor', 
            provider, 
            {
                // Ensures the webview's state is kept even when it's in a background tab.
                webviewOptions: { retainContextWhenHidden: true },
            }
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) { }

    /**
     * Called when our custom editor is opened.
     * It configures the webview and sets up communication between the webview and the extension.
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Configure webview options
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        };

        // Set the HTML content for the webview
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
        
        // Load character data from the local `char.json` file
        const characterDataUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'char.json');
        const characterDataBuffer = await vscode.workspace.fs.readFile(characterDataUri);
        const characterData = JSON.parse(characterDataBuffer.toString());

        // Set up a listener for messages sent from the webview
        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'updateText':
                    this.updateTextDocument(document, e.payload);
                    return;
                case 'requestExport':
                    // The webview is requesting to show the avatar setup modal
                    webviewPanel.webview.postMessage({ type: 'showAvatarModal', payload: e.payload });
                    return;
                case 'finalExport':
                    // The webview has sent all necessary data for the final export
                    this.exportToJson(document, e.payload);
                    return;
                case 'ready':
                    // The webview is ready to receive the initial document data
                    webviewPanel.webview.postMessage({ 
                        type: 'init', 
                        documentText: document.getText(), 
                        characterData: characterData 
                    });
                    return;
            }
        });
    }

    /**
     * Updates the text document with the new data from the webview.
     * @param document The document to update.
     * @param data The data object containing the script and character lists.
     */
    private updateTextDocument(document: vscode.TextDocument, data: { script: any[], customCharacters: any[], temporaryCharacters: any[] }) {
        const edit = new vscode.WorkspaceEdit();
        // Replace the entire document content with the stringified JSON data
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(data, null, 2) // Pretty-print JSON for readability
        );
        vscode.workspace.applyEdit(edit);
    }
    
    /**
     * Handles the final export process, converting the script data into the target JSON format.
     * @param document The source document.
     * @param data The payload from the webview containing script, avatars, and character mappings.
     */
    private async exportToJson(
        document: vscode.TextDocument, 
        data: { 
            script: any[], 
            avatars: { [key: string]: string }, 
            customCharMappings: { [key: string]: { finalId: string, name: string } }, 
            temporaryCharacters: any[] 
        }
    ) {
        try {
            const { script, avatars, customCharMappings, temporaryCharacters } = data;

            // Create a map for quick lookup of temporary character definitions.
            const tempCharMap = new Map(temporaryCharacters.map(char => [char.id, char]));

            /**
             * Helper function to find the base (prototype) ID of any character ID.
             * @param charId The character ID (can be temporary, custom, or standard).
             * @returns The base character ID.
             */
            const getBaseId = (charId: string): string => {
                if (charId.startsWith('temp_')) {
                    return tempCharMap.get(charId)?.baseId || charId;
                }
                // For standard, custom, "me", or "narration", the ID itself is the base.
                return charId;
            };
            
            // 1. Build the "chat" list
            const chat = script.map((line, index) => {
                const currentId = line.characterId;
                const isMe = currentId === 'me';
                const isNarration = currentId === 'narration';
                
                // Default avatar state
                let avatarState = "AUTO";

                // Logic to force show avatar: if the base character is the same as the previous line,
                // but the temporary character name is different (e.g., Student A -> Student B),
                // we must force the avatar to show to indicate a speaker change.
                if (index > 0) {
                    const previousId = script[index - 1].characterId;
                    if (currentId !== 'me' && currentId !== 'narration' && previousId !== 'me' && previousId !== 'narration') {
                        const currentBaseId = getBaseId(currentId);
                        const previousBaseId = getBaseId(previousId);

                        if (currentBaseId === previousBaseId && currentId !== previousId) {
                            avatarState = "SHOW";
                        }
                    }
                }

                // Construct the yuzutalk object
                const yuzutalk = { 
                    type: isNarration ? "NARRATION" : "TEXT", 
                    avatarState: avatarState,
                    nameOverride: "" 
                };

                // Handle "me" and "narration" lines
                if (isMe || isNarration) {
                    return { is_breaking: false, content: line.line, yuzutalk, arknights: { type: "TEXT" } };
                } 
                
                const isCustom = currentId.startsWith('custom_');
                const isTemporary = currentId.startsWith('temp_');
                
                // Handle custom characters
                if (isCustom) {
                    const finalId = customCharMappings[currentId]?.finalId || currentId;
                    return { char_id: finalId, img: "uploaded", is_breaking: false, content: line.line, yuzutalk, arknights: { type: "TEXT" } };
                }
                
                // Handle standard and temporary characters
                let baseId = currentId;
                if (isTemporary) {
                    const tempChar = tempCharMap.get(currentId);
                    if (tempChar) {
                        baseId = tempChar.baseId;
                        yuzutalk.nameOverride = tempChar.name; // Apply the name override for temporary characters
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

            // 2. Build the "chars" list
            const normalCharsList = Object.entries(avatars).map(([id, img]) => ({ char_id: `ba-${id}`, img }));
            const customCharsList = Object.values(customCharMappings).map((mapping: any) => ({ char_id: mapping.finalId, img: "uploaded" }));
            const chars = [...normalCharsList, ...customCharsList];
            
            // 3. Build the "custom_chars" list
            const custom_chars = Object.values(customCharMappings).map((mapping: any) => ({ char_id: mapping.finalId, img: "", name: mapping.name }));

            const exportObject = { chat, chars, custom_chars };

            // Prompt user for a save location
            const defaultUri = vscode.Uri.file(document.uri.fsPath.replace('.vst', '.export.json'));
            const saveUri = await vscode.window.showSaveDialog({ 
                defaultUri: defaultUri,
                filters: { 'JSON Files': ['json'] } 
            });

            if (saveUri) {
                const jsonContent = JSON.stringify(exportObject, null, 2);
                await vscode.workspace.fs.writeFile(saveUri, Buffer.from(jsonContent, 'utf8'));
                vscode.window.showInformationMessage(`剧本已成功导出到: ${saveUri.fsPath}`);
            }
        } catch(e: any) {
            vscode.window.showErrorMessage(`导出失败: ${e.message}`);
        }
    }

    /**
     * Generates the complete HTML content for the webview.
     * @param webview The webview instance.
     * @returns The HTML string.
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        // Get URIs for local resources
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
        const resetCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'reset.css'));
        const stylesCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.css'));
        
        // Use a nonce to allow only specific scripts to run
        const nonce = getNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="
                    default-src 'none'; 
                    style-src ${webview.cspSource} 'unsafe-inline'; 
                    script-src 'nonce-${nonce}';
                ">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${resetCssUri}" rel="stylesheet">
                <link href="${stylesCssUri}" rel="stylesheet">
                <title>VST Editor</title>
            </head>
            <body>
                <div id="controls">
                    <button id="manage-chars-btn" class="control-btn" title="管理临时或自定义角色">管理角色</button>
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
                            <p class="modal-message">导出设置</p>
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
            </html>
        `;
    }
}

/**
 * Generates a random string to be used as a nonce.
 * @returns A 32-character random string.
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}