import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

type ToiTaskState = 'DONE' | 'LOW' | 'TODO' | 'EXCLUDED' | 'EXCLUDED_OK';

interface ToiSummary {
    passing_score: number;
    counted_passed_all_levels: number;
    required_all_levels: number;
    counted_passed_a2_a3: number;
    required_a2_a3: number;
    excluded_passed: number;
    criteria_pass: boolean;
}

interface ToiTask {
    task: string;
    name: string;
    score: number;
    max_score: number;
    level: 'A1' | 'A2' | 'A3';
    passed: boolean;
    excluded: boolean;
    state: ToiTaskState;
    counted: boolean;
}

interface ToiStatusPayload {
    summary: ToiSummary;
    by_level: Record<string, string[]>;
    counted_below_80: ToiTask[];
    tasks: ToiTask[];
    login_token?: string;
}

interface ToiSubmitPayload {
    submit: {
        task: string;
        status_code: number;
        reason: string;
        location: string;
        submission_id?: string;
    };
    submission?: ToiSubmissionResult;
}

interface ToiDownloadPayload {
    download: {
        task: string;
        path: string;
    };
}

interface ToiSubmissionResult {
    task: string;
    submission_id?: string;
    score: number | null;
    max_score: number | null;
    passed: boolean;
    state: 'PASS' | 'NOT_PASS' | 'RUNNING' | 'UNKNOWN';
    done: boolean;
    timed_out?: boolean;
    url: string;
    text_preview: string;
}

interface ToiSubmissionPayload {
    submission: ToiSubmissionResult;
}

const TASK_ID_PATTERN = /^A[123]-\d{3}$/i;
const SECRET_USERNAME = 'toiZero.username';
const SECRET_PASSWORD = 'toiZero.password';

const normalizeTaskId = (task: string) => task.trim().toUpperCase();

const isTaskId = (task: string) => TASK_ID_PATTERN.test(task.trim());

const taskArgumentToId = (taskArg: unknown): string | undefined => {
    if (typeof taskArg === 'string') {
        return taskArg;
    }
    if (taskArg instanceof ToiTaskItem) {
        return taskArg.task.task;
    }
    return undefined;
};

const getWorkspaceFolder = () =>
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

class ToiTaskItem extends vscode.TreeItem {
    constructor(public readonly task: ToiTask) {
        super(
            `${task.task}  ${task.score}/${task.max_score}  ${task.state}`,
            vscode.TreeItemCollapsibleState.None,
        );
        this.description = task.name;
        this.tooltip = `${task.task} - ${task.name}\nScore: ${task.score}/${task.max_score}\nState: ${task.state}`;
        this.contextValue = 'toiTask';
        this.command = {
            command: 'toiZero.pickTask',
            title: 'TOI Zero: Task Actions',
            arguments: [task.task],
        };
        this.iconPath = new vscode.ThemeIcon(this.iconForState(task.state));
    }

    private iconForState(state: ToiTaskState) {
        if (state === 'DONE') {
            return 'pass-filled';
        }
        if (state === 'LOW') {
            return 'warning';
        }
        if (state === 'EXCLUDED' || state === 'EXCLUDED_OK') {
            return 'circle-slash';
        }
        return 'circle-outline';
    }
}

class ToiZeroProvider implements vscode.TreeDataProvider<ToiTaskItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
        ToiTaskItem | undefined | void
    >();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private tasks: ToiTask[] = [];

    refresh(tasks: ToiTask[]) {
        this.tasks = tasks;
        this.onDidChangeTreeDataEmitter.fire();
    }

    getTreeItem(element: ToiTaskItem) {
        return element;
    }

    getChildren() {
        return this.tasks.map((task) => new ToiTaskItem(task));
    }
}

class ToiZeroDashboard implements vscode.WebviewViewProvider {
    static readonly viewType = 'toiZero.dashboard';
    private view?: vscode.WebviewView;
    private status?: ToiStatusPayload;
    private message = 'Click Refresh Status to login and load TOI Zero tasks.';
    private error?: string;
    private busy = false;

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.onDidReceiveMessage((message) => {
            if (typeof message?.command === 'string') {
                vscode.commands.executeCommand(message.command, message.task);
            }
        });
        this.render();
    }

    setBusy(busy: boolean, message?: string) {
        this.busy = busy;
        if (message) {
            this.message = message;
        }
        this.render();
    }

    setStatus(status: ToiStatusPayload, message?: string) {
        this.status = status;
        this.error = undefined;
        this.busy = false;
        this.message = message || 'Connected to TOI Zero.';
        this.render();
    }

    setError(error: string) {
        this.error = error;
        this.busy = false;
        this.message = "TOI Zero server can't connect.";
        this.render();
    }

    setMessage(message: string) {
        this.message = message;
        this.render();
    }

    private render() {
        if (!this.view) {
            return;
        }
        this.view.webview.html = this.html();
    }

    private html() {
        const nonce = Date.now().toString();
        const summary = this.status?.summary;
        const todo = this.status?.tasks.filter((task) => task.state === 'TODO').length;
        const low = this.status?.tasks.filter((task) => task.state === 'LOW').length;
        const done = this.status?.tasks.filter((task) => task.state === 'DONE').length;
        const sampleTasks =
            this.status?.counted_below_80
                .slice(0, 8)
                .map(
                    (task) =>
                        `<li><button data-command="toiZero.pickTask" data-task="${task.task}">${task.task}</button><span>${escapeHtml(
                            task.name,
                        )}</span><strong>${task.score}/${task.max_score}</strong></li>`,
                )
                .join('') || '<li class="empty">Refresh to see unfinished tasks.</li>';

        return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
body {
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    font-family: var(--vscode-font-family);
    margin: 0;
    padding: 14px;
}
.title { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
.credit { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 14px; }
.status {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 12px;
    background: var(--vscode-editor-background);
}
.ok { color: var(--vscode-testing-iconPassed); }
.bad { color: var(--vscode-errorForeground); }
.muted { color: var(--vscode-descriptionForeground); }
.grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 10px 0;
}
.metric {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 10px;
    background: var(--vscode-editor-background);
}
.metric div:first-child { font-size: 20px; font-weight: 700; }
.metric div:last-child { font-size: 11px; color: var(--vscode-descriptionForeground); }
.actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    margin-bottom: 14px;
}
button {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    border-radius: 4px;
    padding: 8px 10px;
    text-align: left;
    cursor: pointer;
}
button:hover { background: var(--vscode-button-hoverBackground); }
.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
}
.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.error {
    white-space: pre-wrap;
    color: var(--vscode-errorForeground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    background: var(--vscode-inputValidation-errorBackground);
    padding: 10px;
    border-radius: 6px;
    margin-bottom: 12px;
}
ul { list-style: none; padding: 0; margin: 0; }
li {
    display: grid;
    grid-template-columns: 72px 1fr auto;
    gap: 8px;
    align-items: center;
    border-bottom: 1px solid var(--vscode-panel-border);
    padding: 6px 0;
}
li button { padding: 4px 6px; text-align: center; }
li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
li strong { font-size: 11px; color: var(--vscode-descriptionForeground); }
.empty { display: block; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
    <div class="title">TOI Zero</div>
    <div class="credit">Solution shortcut credit: GitHub PakinDioxide</div>
    <div class="status">
        <div class="${this.error ? 'bad' : summary?.criteria_pass ? 'ok' : 'muted'}">${escapeHtml(
            this.busy ? 'Loading...' : this.message,
        )}</div>
    </div>
    ${this.error ? `<div class="error">${escapeHtml(this.error)}</div>` : ''}
    <div class="grid">
        <div class="metric"><div>${summary ? `${summary.counted_passed_all_levels}/${summary.required_all_levels}` : '-'}</div><div>All counted</div></div>
        <div class="metric"><div>${summary ? `${summary.counted_passed_a2_a3}/${summary.required_a2_a3}` : '-'}</div><div>A2 + A3</div></div>
        <div class="metric"><div>${done ?? '-'}</div><div>Done</div></div>
        <div class="metric"><div>${low ?? '-'}/${todo ?? '-'}</div><div>Low / Todo</div></div>
    </div>
    <div class="actions">
        <button data-command="toiZero.refreshStatus">Refresh Status / Login</button>
        <button data-command="toiZero.downloadPdf" class="secondary">Download PDF</button>
        <button data-command="toiZero.submitActiveFile" class="secondary">Submit Active File</button>
        <button data-command="toiZero.checkSubmission" class="secondary">Check Submission Result</button>
        <button data-command="toiZero.openSolution" class="secondary">Open Solution</button>
        <button data-command="toiZero.showStatusJson" class="secondary">Open Status JSON</button>
        <button data-command="toiZero.clearCredentials" class="secondary">Clear Login</button>
    </div>
    <h3>Need Work</h3>
    <ul>${sampleTasks}</ul>
    <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button[data-command]').forEach((button) => {
        button.addEventListener('click', () => {
            vscode.postMessage({
                command: button.getAttribute('data-command'),
                task: button.getAttribute('data-task') || undefined,
            });
        });
    });
    </script>
</body>
</html>`;
    }
}

const escapeHtml = (value: unknown) =>
    String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

export default function registerToiZero(context: vscode.ExtensionContext) {
    const provider = new ToiZeroProvider();
    const dashboard = new ToiZeroDashboard();
    let cachedStatus: ToiStatusPayload | undefined;

    const runPython = async <T>(args: string[]): Promise<T> => {
        const pythonPath = vscode.workspace
            .getConfiguration('toiZero')
            .get<string>('pythonPath', 'python');
        const scriptPath = path.join(
            context.extensionPath,
            'dist',
            'static',
            'toi_pre.py',
        );

        return new Promise<T>((resolve, reject) => {
            cp.execFile(
                pythonPath,
                [scriptPath, ...args],
                { cwd: getWorkspaceFolder(), maxBuffer: 20 * 1024 * 1024 },
                (error, stdout, stderr) => {
                    if (error) {
                        reject(
                            new Error(
                                stderr.trim() ||
                                    stdout.trim() ||
                                    error.message,
                            ),
                        );
                        return;
                    }
                    try {
                        resolve(JSON.parse(stdout) as T);
                    } catch (e) {
                        reject(
                            new Error(
                                `Cannot parse TOI JSON output:\n${stdout}\n${String(
                                    e,
                                )}`,
                            ),
                        );
                    }
                },
            );
        });
    };

    const getCredentials = async () => {
        let username = await context.secrets.get(SECRET_USERNAME);
        let password = await context.secrets.get(SECRET_PASSWORD);

        if (!username) {
            username = await vscode.window.showInputBox({
                prompt: 'TOI username',
                ignoreFocusOut: true,
            });
            if (!username) {
                throw new Error('TOI username is required.');
            }
            await context.secrets.store(SECRET_USERNAME, username);
        }

        if (!password) {
            password = await vscode.window.showInputBox({
                prompt: 'TOI password',
                password: true,
                ignoreFocusOut: true,
            });
            if (!password) {
                throw new Error('TOI password is required.');
            }
            await context.secrets.store(SECRET_PASSWORD, password);
        }

        return { username, password };
    };

    const withCredentials = async (args: string[]) => {
        const { username, password } = await getCredentials();
        return ['-u', username, '-p', password, ...args];
    };

    const refreshStatus = async () => {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'TOI Zero: loading status',
            },
            async () => {
                try {
                    dashboard.setBusy(true, 'Connecting to TOI Zero...');
                    cachedStatus = await runPython<ToiStatusPayload>(
                        await withCredentials(['--status', '--json']),
                    );
                    provider.refresh(cachedStatus.tasks);
                    const summary = cachedStatus.summary;
                    const message = `${summary.counted_passed_all_levels}/${summary.required_all_levels} all, ${summary.counted_passed_a2_a3}/${summary.required_a2_a3} A2+A3, criteria ${summary.criteria_pass ? 'PASS' : 'NOT PASS'}.`;
                    dashboard.setStatus(cachedStatus, message);
                    vscode.window.showInformationMessage(`TOI Zero: ${message}`);
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message : String(error);
                    dashboard.setError(message);
                    vscode.window.showErrorMessage(
                        `TOI Zero server can't connect: ${message}`,
                    );
                }
            },
        );
    };

    const pickTaskId = async (placeHolder: string) => {
        const items =
            cachedStatus?.tasks.map((task) => ({
                label: task.task,
                description: `${task.score}/${task.max_score} ${task.state}`,
                detail: task.name,
            })) || [];

        if (items.length > 0) {
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder,
                matchOnDescription: true,
                matchOnDetail: true,
            });
            return picked?.label;
        }

        const task = await vscode.window.showInputBox({
            prompt: placeHolder,
            placeHolder: 'A1-001',
            ignoreFocusOut: true,
        });
        if (!task) {
            return undefined;
        }
        const normalized = normalizeTaskId(task);
        if (!isTaskId(normalized)) {
            throw new Error('Invalid task ID. Example: A1-001');
        }
        return normalized;
    };

    const taskFromActiveFile = () => {
        const file = vscode.window.activeTextEditor?.document.fileName;
        if (!file) {
            return undefined;
        }
        const name = path.basename(file).toUpperCase();
        return name.match(/A[123]-\d{3}/)?.[0];
    };

    const languageFromActiveFile = () => {
        const file = vscode.window.activeTextEditor?.document.fileName || '';
        const ext = path.extname(file).toLowerCase();
        if (ext === '.cpp' || ext === '.cc' || ext === '.cxx') {
            return 'C++17 / g++';
        }
        if (ext === '.c') {
            return 'C11 / gcc';
        }
        return 'Python 3 / CPython';
    };

    const showStatusJson = async () => {
        if (!cachedStatus) {
            await refreshStatus();
        }
        const document = await vscode.workspace.openTextDocument({
            content: JSON.stringify(cachedStatus, null, 2),
            language: 'json',
        });
        await vscode.window.showTextDocument(document);
    };

    const downloadPdf = async (taskArg?: unknown) => {
        try {
            const task =
                taskArgumentToId(taskArg) ||
                (await pickTaskId('Download TOI statement PDF'));
            if (!task) {
                return;
            }
            dashboard.setBusy(true, `Downloading ${normalizeTaskId(task)} PDF...`);
            const outputDir = path.join(getWorkspaceFolder(), 'toi-pdfs');
            const payload = await runPython<ToiDownloadPayload>(
                await withCredentials([
                    '--download',
                    normalizeTaskId(task),
                    '--download-dir',
                    outputDir,
                    '--json',
                ]),
            );
            const uri = vscode.Uri.file(payload.download.path);
            dashboard.setMessage(`Downloaded ${normalizeTaskId(task)} PDF.`);
            await vscode.commands.executeCommand('vscode.open', uri);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dashboard.setError(message);
            vscode.window.showErrorMessage(
                `TOI Zero server can't connect: ${message}`,
            );
        }
    };

    const submitActiveFile = async (taskArg?: unknown) => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error('Open a source file before submitting.');
            }
            if (editor.document.isDirty) {
                await editor.document.save();
            }

            const task =
                taskArgumentToId(taskArg) ||
                taskFromActiveFile() ||
                (await pickTaskId('Submit current file to TOI task'));
            if (!task) {
                return;
            }

            dashboard.setBusy(true, `Submitting ${normalizeTaskId(task)}...`);
            const payload = await runPython<ToiSubmitPayload>(
                await withCredentials([
                    '-t',
                    normalizeTaskId(task),
                    '-l',
                    languageFromActiveFile(),
                    '-f',
                    editor.document.fileName,
                    '--wait-submit-result',
                    '60',
                    '--json',
                ]),
            );
            if (payload.submission) {
                const result = payload.submission;
                const score =
                    result.score === null
                        ? 'score unknown'
                        : `${result.score}/${result.max_score}`;
                vscode.window.showInformationMessage(
                    `TOI submit ${payload.submit.task}: ${result.state} (${score})`,
                );
                dashboard.setMessage(
                    `Submit ${payload.submit.task}: ${result.state} (${score})`,
                );
            } else {
                vscode.window.showInformationMessage(
                    `TOI submit ${payload.submit.task}: HTTP ${payload.submit.status_code} ${payload.submit.reason}`,
                );
                dashboard.setMessage(
                    `Submit ${payload.submit.task}: HTTP ${payload.submit.status_code} ${payload.submit.reason}`,
                );
            }
            await refreshStatus();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dashboard.setError(message);
            vscode.window.showErrorMessage(
                `TOI Zero server can't connect: ${message}`,
            );
        }
    };

    const checkSubmission = async (taskArg?: unknown) => {
        try {
            const task =
                taskArgumentToId(taskArg) ||
                taskFromActiveFile() ||
                (await pickTaskId('Check TOI submission result'));
            if (!task) {
                return;
            }
            dashboard.setBusy(true, `Checking ${normalizeTaskId(task)} result...`);
            const payload = await runPython<ToiSubmissionPayload>(
                await withCredentials([
                    '--check-submission',
                    normalizeTaskId(task),
                    '--wait',
                    '30',
                    '--json',
                ]),
            );
            const result = payload.submission;
            const score =
                result.score === null
                    ? 'score unknown'
                    : `${result.score}/${result.max_score}`;
            vscode.window.showInformationMessage(
                `TOI ${result.task}: ${result.state} (${score})`,
            );
            dashboard.setMessage(`Check ${result.task}: ${result.state} (${score})`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dashboard.setError(message);
            vscode.window.showErrorMessage(
                `TOI Zero server can't connect: ${message}`,
            );
        }
    };

    const openSolution = async (taskArg?: unknown) => {
        const task =
            taskArgumentToId(taskArg) ||
            (await pickTaskId('Open solution search'));
        if (!task) {
            return;
        }
        const url = vscode.Uri.parse(
            `https://github.com/search?q=user%3APakinDioxide+${encodeURIComponent(
                normalizeTaskId(task),
            )}&type=code`,
        );
        await vscode.env.openExternal(url);
        vscode.window.showInformationMessage(
            'Solution credit: GitHub PakinDioxide',
        );
    };

    const clearCredentials = async () => {
        await context.secrets.delete(SECRET_USERNAME);
        await context.secrets.delete(SECRET_PASSWORD);
        dashboard.setMessage('Saved TOI login cleared.');
        vscode.window.showInformationMessage('TOI Zero credentials cleared.');
    };

    const pickTaskActions = async (task: string) => {
        const action = await vscode.window.showQuickPick(
            [
                'Download PDF',
                'Submit active file',
                'Check submission',
                'Open solution',
                'Copy task ID',
            ],
            { placeHolder: task },
        );
        if (action === 'Download PDF') {
            await downloadPdf(task);
        } else if (action === 'Submit active file') {
            await submitActiveFile(task);
        } else if (action === 'Open solution') {
            await openSolution(task);
        } else if (action === 'Check submission') {
            await checkSubmission(task);
        } else if (action === 'Copy task ID') {
            await vscode.env.clipboard.writeText(task);
        }
    };

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ToiZeroDashboard.viewType,
            dashboard,
        ),
        vscode.window.registerTreeDataProvider('toiZero.tasks', provider),
        vscode.commands.registerCommand('toiZero.refreshStatus', refreshStatus),
        vscode.commands.registerCommand('toiZero.showStatusJson', showStatusJson),
        vscode.commands.registerCommand('toiZero.downloadPdf', downloadPdf),
        vscode.commands.registerCommand('toiZero.submitActiveFile', submitActiveFile),
        vscode.commands.registerCommand('toiZero.checkSubmission', checkSubmission),
        vscode.commands.registerCommand('toiZero.openSolution', openSolution),
        vscode.commands.registerCommand('toiZero.clearCredentials', clearCredentials),
        vscode.commands.registerCommand('toiZero.pickTask', pickTaskActions),
    );
}
