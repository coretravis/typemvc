import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const serverModule = context.asAbsolutePath('out/server.js');

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'tmvc' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.tmvc'),
    },
  };

  client = new LanguageClient(
    'tmvc-language-server',
    'TypeMVC Language Server',
    serverOptions,
    clientOptions,
  );

  try {
    await client.start();
    context.subscriptions.push(client);
  } catch (err) {
    void vscode.window.showErrorMessage(`TypeMVC language server failed to start: ${String(err)}`);
    throw err;
  }
}

export function deactivate(): Promise<void> | undefined {
  return client?.stop();
}
