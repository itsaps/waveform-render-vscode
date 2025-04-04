import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";

/**
 * Pads the end of a string with spaces or a specified character.
 * @param str The string to pad.
 * @param targetLength The length of the resulting string after padding.
 * @param padChar The character to pad with (default is space).
 * @returns The padded string.
 */
function padEnd(str: string, targetLength: number, padChar: string = ' '): string {
  if (str.length >= targetLength) {
      return str;
  }
  return str + padChar.repeat(targetLength - str.length);
}

/**
 * Converts a WaveDrom signal object into ASCII Art.
 * @param signals - The array of signals from the WaveDrom JSON.
 * @returns The ASCII Art representation as a string.
 */
function generateAsciiArt(signals: { name: string; wave: string }[]): string {
  const waveMapping: { [key: string]: string } = {
      "P": "|‾‾‾‾|",
      "0": "____",
      "1": "‾‾‾‾",
      ".": "    ",
      "x": "xxxx",
      "=": "====",
  };

  let asciiArt = '';
  for (const signal of signals) {
      asciiArt += `${padEnd(signal.name,10)}: `;
      const wave = signal.wave.split('').map(char => waveMapping[char] || '????').join('');
      asciiArt += `${wave}\n`;
  }
  return asciiArt;
}



export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("waveformRender.start", () => {
      WaveformRenderPanel.disableLivePreview();
      vscode.window.showInformationMessage(
        "Waveform refreshed manually, Live Preview OFF"
      );
      WaveformRenderPanel.createOrShow(context.extensionPath);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("waveformRender.toggleLivePreview", () => {
      WaveformRenderPanel.toggleLivePreview(context.extensionPath);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("waveform-render.generateAscii", async () => {
      try {
        // Step 1: Request the user to select a JSON file
        const fileUri = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Select Waveform JSON',
            filters: { 'JSON Files': ['json'] }
        });

        if (!fileUri || fileUri.length === 0) {
            vscode.window.showWarningMessage('No file selected.');
            return;
        }

        const filePath = fileUri[0].fsPath;

        // Step 2: Read and parse the JSON file
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const parsedContent = JSON.parse(fileContent);

        // Validate the structure of the JSON
        if (!parsedContent || !Array.isArray(parsedContent.signal)) {
            vscode.window.showErrorMessage('Invalid WaveDrom JSON file: Missing "signal" array.');
            return;
        }

        // Step 3: Generate ASCII Art
        const asciiArt = generateAsciiArt(parsedContent.signal);

        // Step 4: Open a new editor with the generated ASCII Art
        const document = await vscode.workspace.openTextDocument({
            content: asciiArt,
            language: 'plaintext',
        });

        await vscode.window.showTextDocument(document);
      } catch (error) {
          // Handle errors gracefully
          console.error('Error generating ASCII Art:', error);
          vscode.window.showErrorMessage('An error occurred while generating ASCII Art. See console for details.');
      }
    })
  );
}

function getTitle() {
  return (
    "Waveform Render: " +
    vscode.window.activeTextEditor.document.fileName
      .split("\\")
      .pop()
      .split("/")
      .pop()
  );
}

/**
 * Manages webview panel
 */
class WaveformRenderPanel {
  /**
   * Track the currently panel. Only allow a single panel to exist at a time.
   */
  public static currentPanel: WaveformRenderPanel | undefined;

  public static livePreview: boolean = false;
  public static livePreviewDocumentPath;
  public static listenerTextChange;

  public static readonly viewType = "waveformRender";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private _disposables: vscode.Disposable[] = [];

  public static toggleLivePreview(extensionPath: string) {
    if (WaveformRenderPanel.livePreview) {
      WaveformRenderPanel.disableLivePreview();
    } else {
      WaveformRenderPanel.livePreviewDocumentPath =
        vscode.window.activeTextEditor.document.uri.path;
      WaveformRenderPanel.listenerTextChange =
        vscode.workspace.onDidChangeTextDocument(function (event) {
          WaveformRenderPanel.createOrShow(extensionPath);
        });
      WaveformRenderPanel.livePreview = true;
      WaveformRenderPanel.createOrShow(extensionPath);
    }
    vscode.window.showInformationMessage(
      "Waveform Live Preview: " +
        (WaveformRenderPanel.livePreview ? "ON" : "OFF")
    );
  }

  public static disableLivePreview() {
    WaveformRenderPanel.livePreviewDocumentPath = null;
    if (WaveformRenderPanel.listenerTextChange) {
      WaveformRenderPanel.listenerTextChange.dispose();
    }
    WaveformRenderPanel.livePreview = false;
  }

  public static createOrShow(extensionPath: string) {
    // If we already have a panel, show it.
    if (WaveformRenderPanel.currentPanel) {
      // If live preview is on, only update the document where it was activated
      if (
        WaveformRenderPanel.livePreview &&
        WaveformRenderPanel.livePreviewDocumentPath !=
          vscode.window.activeTextEditor.document.uri.path
      ) {
        return;
      } else {
        WaveformRenderPanel.currentPanel._panel.title = getTitle();
        WaveformRenderPanel.currentPanel._updateWithFileContent();
        return;
      }
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      WaveformRenderPanel.viewType,
      getTitle(),
      { preserveFocus: true, viewColumn: -2 },
      {
        // Enable javascript in the webview
        enableScripts: true,

        // And restrict the webview to only loading content from our extension's `localScripts` directory.
        localResourceRoots: [
          vscode.Uri.file(path.join(extensionPath, "localScripts")),
        ],
      }
    );

    WaveformRenderPanel.currentPanel = new WaveformRenderPanel(
      panel,
      extensionPath
    );
  }

  private constructor(panel: vscode.WebviewPanel, extensionPath: string) {
    this._panel = panel;
    this._extensionPath = extensionPath;

    this._updateWithFileContent();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public dispose() {
    WaveformRenderPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _updateWithFileContent() {
    // Get the current text editor
    let editor = vscode.window.activeTextEditor;
    let doc = editor.document;
    let docContent = doc.getText();

    // Set the webview's html content
    this._update(docContent);
  }

  private _update(
    fileContents: string = `{ signal: [
    { name: "clk",         wave: "p.....|..." },
    { name: "Data",        wave: "x.345x|=.x", data: ["head", "body", "tail", "data"] },
    { name: "Request",     wave: "0.1..0|1.0" },
    {},
    { name: "Acknowledge", wave: "1.....|01." }
  ]}`
  ) {
    this._panel.webview.html = this._getHtmlForWebview(fileContents);
  }

  private _getHtmlForWebview(waveformJson: string) {
    const scriptPathOnDisk = vscode.Uri.file(
      path.join(this._extensionPath, "localScripts", "wavedrom.min.js")
    );
    const defaultSkinPathOnDisk = vscode.Uri.file(
      path.join(this._extensionPath, "localScripts/skins", "default.js")
    );
    const narrowSkinPathOnDisk = vscode.Uri.file(
      path.join(this._extensionPath, "localScripts/skins", "narrow.js")
    );
    const lowkeySkinPathOnDisk = vscode.Uri.file(
      path.join(this._extensionPath, "localScripts/skins", "lowkey.js")
    );

    // And the uri we use to load this script in the webview
    const scriptUri = this._panel.webview.asWebviewUri(scriptPathOnDisk);
    const defaultUri = this._panel.webview.asWebviewUri(defaultSkinPathOnDisk);
    const narrowUri = this._panel.webview.asWebviewUri(narrowSkinPathOnDisk);
    const lowkeyUri = this._panel.webview.asWebviewUri(lowkeySkinPathOnDisk);

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">

                  <script src="${scriptUri}"></script>

                  <script src="${defaultUri}"></script>
                  <script src="${narrowUri}"></script>
                  <script src="${lowkeyUri}"></script>

                  <title>waveform render</title>
            </head>

            <body onload="WaveDrom.ProcessAll()" style="background-color: white;">
              <div>
                <script type="WaveDrom">
                  ${waveformJson}
                </script>
              </div>
            </body>
            </html>`;
  }
}
