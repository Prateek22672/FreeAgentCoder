import * as vscode from 'vscode';

class FreeAgentCoderViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'freeagentcoder.chat';

	constructor(private readonly extensionUri: vscode.Uri) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		webviewView.webview.options = {
			enableScripts: true,
		};

		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'send':
					vscode.window.showInformationMessage(
						`FreeAgentCoder received: ${message.text}`
					);
					break;

				case 'newChat':
					webviewView.webview.postMessage({
						type: 'clearChat',
					});
					break;
			}
		});
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">

	<meta
		http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"
	>

	<meta name="viewport" content="width=device-width, initial-scale=1.0">

	<style>
		* {
			box-sizing: border-box;
		}

		body {
			margin: 0;
			padding: 0;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-sideBar-background);
			height: 100vh;
			overflow: hidden;
		}

		.container {
			height: 100vh;
			display: flex;
			flex-direction: column;
		}

		.header {
			padding: 12px 14px;
			border-bottom: 1px solid var(--vscode-panel-border);
			display: flex;
			align-items: center;
			justify-content: space-between;
		}

		.brand {
			display: flex;
			align-items: center;
			gap: 8px;
			font-weight: 600;
		}

		.logo {
			font-size: 18px;
		}

		.new-chat {
			border: none;
			background: transparent;
			color: var(--vscode-foreground);
			cursor: pointer;
			padding: 4px 6px;
			border-radius: 4px;
		}

		.new-chat:hover {
			background: var(--vscode-toolbar-hoverBackground);
		}

		.messages {
			flex: 1;
			overflow-y: auto;
			padding: 14px;
		}

		.welcome {
			margin-top: 25%;
			text-align: center;
			padding: 10px;
		}

		.welcome h2 {
			margin-bottom: 8px;
			font-size: 18px;
		}

		.welcome p {
			opacity: 0.7;
			line-height: 1.5;
			font-size: 13px;
		}

		.message {
			margin-bottom: 14px;
			padding: 10px;
			border-radius: 8px;
			line-height: 1.5;
			font-size: 13px;
		}

		.user {
			background: var(--vscode-textBlockQuote-background);
			border: 1px solid var(--vscode-textBlockQuote-border);
		}

		.agent {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-panel-border);
		}

		.label {
			font-size: 11px;
			opacity: 0.65;
			margin-bottom: 5px;
			font-weight: 600;
		}

		.input-area {
			padding: 10px;
			border-top: 1px solid var(--vscode-panel-border);
		}

		.input-box {
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			border-radius: 8px;
			padding: 8px;
		}

		textarea {
			width: 100%;
			resize: none;
			border: none;
			outline: none;
			background: transparent;
			color: var(--vscode-input-foreground);
			font-family: inherit;
			font-size: 13px;
			min-height: 55px;
		}

		textarea::placeholder {
			color: var(--vscode-input-placeholderForeground);
		}

		.bottom {
			display: flex;
			justify-content: flex-end;
			margin-top: 6px;
		}

		.send {
			border: none;
			border-radius: 5px;
			padding: 5px 12px;
			cursor: pointer;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		.send:hover {
			background: var(--vscode-button-hoverBackground);
		}
	</style>
</head>

<body>
	<div class="container">

		<div class="header">
			<div class="brand">
				<span class="logo">🤖</span>
				<span>FreeAgentCoder</span>
			</div>

			<button class="new-chat" id="newChat" title="New chat">
				＋
			</button>
		</div>

		<div class="messages" id="messages">
			<div class="welcome" id="welcome">
				<h2>FreeAgentCoder</h2>
				<p>
					Your autonomous AI coding agent.
					<br><br>
					Ask me to read, create, edit, debug or improve your code.
				</p>
			</div>
		</div>

		<div class="input-area">
			<div class="input-box">
				<textarea
					id="input"
					placeholder="Ask FreeAgentCoder..."
				></textarea>

				<div class="bottom">
					<button class="send" id="send">Send</button>
				</div>
			</div>
		</div>

	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();

		const input = document.getElementById('input');
		const send = document.getElementById('send');
		const messages = document.getElementById('messages');
		const welcome = document.getElementById('welcome');
		const newChat = document.getElementById('newChat');

		function addMessage(type, text) {
			if (welcome) {
				welcome.remove();
			}

			const message = document.createElement('div');
			message.className = 'message ' + type;

			const label = document.createElement('div');
			label.className = 'label';
			label.textContent = type === 'user' ? 'You' : 'FreeAgentCoder';

			const content = document.createElement('div');
			content.textContent = text;

			message.appendChild(label);
			message.appendChild(content);

			messages.appendChild(message);
			messages.scrollTop = messages.scrollHeight;
		}

		function sendMessage() {
			const text = input.value.trim();

			if (!text) {
				return;
			}

			addMessage('user', text);

			vscode.postMessage({
				type: 'send',
				text: text
			});

			input.value = '';
			input.focus();

			// Temporary response until the real Agentic engine is connected.
			setTimeout(() => {
				addMessage(
					'agent',
					'Agentic engine connection coming next...'
				);
			}, 300);
		}

		send.addEventListener('click', sendMessage);

		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				sendMessage();
			}
		});

		newChat.addEventListener('click', () => {
			messages.innerHTML = '';
			messages.appendChild(
				Object.assign(document.createElement('div'), {
					className: 'welcome',
					innerHTML: '<h2>FreeAgentCoder</h2><p>What are we building today?</p>'
				})
			);
		});
	</script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const characters =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

	let result = '';

	for (let i = 0; i < 32; i++) {
		result += characters.charAt(
			Math.floor(Math.random() * characters.length)
		);
	}

	return result;
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new FreeAgentCoderViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			FreeAgentCoderViewProvider.viewType,
			provider
		)
	);

	const openCommand = vscode.commands.registerCommand(
		'freeagentcoder.open',
		() => {
			vscode.commands.executeCommand(
				'workbench.view.extension.freeagentcoder'
			);
		}
	);

	context.subscriptions.push(openCommand);

	console.log('FreeAgentCoder is now active!');
}

export function deactivate() {}