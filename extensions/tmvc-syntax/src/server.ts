import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as node from '@volar/language-server/node';
import type { VirtualCode, IScriptSnapshot } from '@volar/language-core';
import { URI } from 'vscode-uri';
import { createTmvcLanguagePlugin } from '@typemvc/core/volar';
import type { TmvcSnapshot } from '@typemvc/core/volar';
import * as tsService from 'volar-service-typescript';

const ScriptKind = { TS: 3, Deferred: 7 } as const;

function createUriAdapterPlugin(asFileName: (uri: URI) => string, workspaceRoot: string) {
  const inner = createTmvcLanguagePlugin({ workspaceRoot });
  return {
    getLanguageId(scriptId: URI): string | undefined {
      const fileName = asFileName(scriptId);
      const lang = inner.getLanguageId(fileName);
      if (lang) process.stderr.write(`[tmvc] getLanguageId(${fileName}) => ${lang}\n`);
      return lang;
    },
    createVirtualCode(
      scriptId: URI,
      languageId: string,
      snapshot: IScriptSnapshot,
    ): VirtualCode | undefined {
      const fileName = asFileName(scriptId);
      process.stderr.write(`[tmvc] createVirtualCode(${fileName}, ${languageId})\n`);
      return inner.createVirtualCode(
        fileName,
        languageId,
        snapshot as TmvcSnapshot,
      ) as VirtualCode | undefined;
    },
    updateVirtualCode(
      scriptId: URI,
      virtualCode: VirtualCode,
      newSnapshot: IScriptSnapshot,
    ): VirtualCode | undefined {
      return inner.updateVirtualCode(
        asFileName(scriptId),
        virtualCode as Parameters<typeof inner.updateVirtualCode>[1],
        newSnapshot as TmvcSnapshot,
      ) as VirtualCode;
    },
    typescript: {
      extraFileExtensions: [
        { extension: 'tmvc', isMixedContent: true, scriptKind: ScriptKind.Deferred },
      ],
      getServiceScript(root: VirtualCode) {
        return { code: root, extension: '.ts' as const, scriptKind: ScriptKind.TS };
      },
    },
  };
}

process.on('uncaughtException', (err) => {
  process.stderr.write(`[tmvc] UNCAUGHT: ${String(err)}\n${(err as Error).stack ?? ''}\n`);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[tmvc] UNHANDLED REJECTION: ${String(reason)}\n`);
});

process.stderr.write('[tmvc] server process started\n');

const connection = node.createConnection();
const server = node.createServer(connection);

connection.listen();

connection.onInitialize((params) => {
  process.stderr.write('[tmvc] onInitialize\n');

  const tsSdkOption = params.initializationOptions?.typescript?.tsdk as string | undefined;
  const tsSdkPath =
    typeof tsSdkOption === 'string' && tsSdkOption.length > 0
      ? tsSdkOption
      : path.dirname(require.resolve('typescript'));

  const { typescript: ts, diagnosticMessages: tsLocalized } = node.loadTsdkByPath(
    tsSdkPath,
    params.locale,
  );

  const workspaceUri = params.workspaceFolders?.[0]?.uri;
  const workspaceRoot =
    typeof workspaceUri === 'string'
      ? fileURLToPath(workspaceUri)
      : (params.rootPath ?? process.cwd());

  return server.initialize(
    params,
    node.createTypeScriptProject(ts, tsLocalized, (ctx) => {
      process.stderr.write('[tmvc] project factory called\n');
      try {
        const plugin = createUriAdapterPlugin(
          (uri: URI) => ctx.uriConverter.asFileName(uri),
          workspaceRoot,
        );
        process.stderr.write('[tmvc] plugin created ok\n');
        return { languagePlugins: [plugin] };
      } catch (err) {
        process.stderr.write(`[tmvc] plugin creation error: ${String(err)}\n`);
        throw err;
      }
    }),
    tsService.create(ts),
  );
});

connection.onInitialized(() => {
  process.stderr.write('[tmvc] onInitialized\n');
  server.initialized();
});

connection.onShutdown(() => {
  server.shutdown();
});
