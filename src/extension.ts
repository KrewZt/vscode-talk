// src/extension.ts
import * as vscode from 'vscode';
import { VstEditorProvider } from './vstEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    // 注册我们的自定义编辑器 Provider
    context.subscriptions.push(VstEditorProvider.register(context));
}

export function deactivate() {}