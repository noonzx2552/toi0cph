import * as cp from 'child_process';
import * as fs from 'fs';
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
const DASHBOARD_ALLOWED_COMMANDS = new Set([
    'toiZero.refreshStatus',
    'toiZero.downloadPdf',
    'toiZero.openDownloadedPdf',
    'cph.runTestCases',
    'toiZero.submitActiveFile',
    'toiZero.checkSubmission',
    'toiZero.openSolution',
    'toiZero.showStatusJson',
    'toiZero.clearCredentials',
    'toiZero.pickTask',
]);

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
    private errorDetails?: string;
    private lastSubmission?: ToiSubmissionResult;
    private lastDownload?: ToiDownloadPayload['download'];
    private busy = false;

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.onDidReceiveMessage((message) => {
            if (typeof message?.command === 'string') {
                if (!DASHBOARD_ALLOWED_COMMANDS.has(message.command)) {
                    return;
                }
                const args: unknown[] = [];
                if (typeof message.task === 'string' && message.task.trim()) {
                    args.push(message.task);
                }
                if (typeof message.path === 'string' && message.path.trim()) {
                    args.push(message.path);
                }
                void vscode.commands.executeCommand(message.command, ...args);
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
        this.errorDetails = undefined;
        this.busy = false;
        this.message = message || 'Connected to TOI Zero.';
        this.render();
    }

    setSubmissionResult(result: ToiSubmissionResult, message?: string) {
        this.lastSubmission = result;
        this.error = undefined;
        this.errorDetails = undefined;
        this.busy = false;
        this.message = message || 'Submission result updated.';
        this.render();
    }

    setDownloaded(download: ToiDownloadPayload['download'], message?: string) {
        this.lastDownload = download;
        this.error = undefined;
        this.errorDetails = undefined;
        this.busy = false;
        this.message = message || 'PDF downloaded.';
        this.render();
    }

    clearState(message?: string) {
        this.status = undefined;
        this.error = undefined;
        this.errorDetails = undefined;
        this.lastSubmission = undefined;
        this.lastDownload = undefined;
        this.busy = false;
        this.message =
            message || 'Click Refresh Status to login and load TOI Zero tasks.';
        this.render();
    }

    setError(error: string, details?: string) {
        this.error = error;
        this.errorDetails = details;
        this.busy = false;
        this.message = error;
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
        const downloadTaskFolders = this.status
            ? ['A1', 'A2', 'A3']
                  .map((level) => {
                      const levelTasks = this.status?.tasks
                          .filter((task) => task.level === level)
                          .sort((a, b) => a.task.localeCompare(b.task));
                      const taskButtons =
                          levelTasks && levelTasks.length > 0
                              ? levelTasks
                                    .map(
                                        (task) =>
                                            `<button data-command="toiZero.downloadPdf" data-task="${task.task}" class="task-chip">${task.task}</button>`,
                                    )
                                    .join('')
                              : '<div class="empty-inline">No tasks</div>';

                      return `<details class="task-folder" ${
                          level === 'A1' ? 'open' : ''
                      }><summary>${level} <span>${levelTasks?.length || 0}</span></summary><div class="task-folder-grid">${taskButtons}</div></details>`;
                  })
                  .join('')
            : '<small class="muted">Refresh Status to load task folders.</small>';

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
    color: var(--vscode-errorForeground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    background: var(--vscode-inputValidation-errorBackground);
    padding: 10px;
    border-radius: 6px;
    margin-bottom: 12px;
}
.error p { margin: 0 0 8px 0; }
.error details { margin-top: 8px; }
.error summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
.error pre {
    white-space: pre-wrap;
    margin: 8px 0 0 0;
    padding: 8px;
    border-radius: 4px;
    background: var(--vscode-editor-background);
    color: var(--vscode-descriptionForeground);
}
.error-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}
.result {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 12px;
    background: var(--vscode-editor-background);
}
.result h3 {
    margin: 0 0 8px 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.result-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
}
.pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid var(--vscode-panel-border);
}
.pill.pass { color: var(--vscode-testing-iconPassed); border-color: var(--vscode-testing-iconPassed); }
.pill.fail { color: var(--vscode-testing-iconFailed); border-color: var(--vscode-testing-iconFailed); }
.pill.run { color: var(--vscode-testing-iconQueued); border-color: var(--vscode-testing-iconQueued); }
.result small { color: var(--vscode-descriptionForeground); }
.download-box {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 12px;
    background: var(--vscode-editor-background);
}
.download-box h3 {
    margin: 0 0 8px 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.download-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    margin-bottom: 8px;
}
input[type="text"] {
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 8px;
}
.download-last {
    display: grid;
    gap: 8px;
}
.task-folders {
    display: grid;
    gap: 8px;
    margin-top: 10px;
}
.task-folder {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 6px 8px;
    background: color-mix(in srgb, var(--vscode-editor-background) 84%, transparent);
}
.task-folder summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--vscode-foreground);
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.task-folder summary span {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
}
.task-folder-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin-top: 8px;
}
.task-chip {
    text-align: center;
    padding: 6px 4px;
    font-size: 12px;
}
.empty-inline {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
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
.footer-credit {
    margin-top: 16px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
}
</style>
</head>
<body>
    <div class="title">TOI Zero</div>
    <div class="status">
        <div class="${this.error ? 'bad' : summary?.criteria_pass ? 'ok' : 'muted'}">${escapeHtml(
            this.busy ? 'Loading...' : this.message,
        )}</div>
    </div>
    ${
        this.lastSubmission
            ? `<div class="result"><h3>Last Submission</h3><div class="result-row"><div><strong>${escapeHtml(
                  this.lastSubmission.task,
              )}</strong> <span class="pill ${
                  this.lastSubmission.state === 'PASS'
                      ? 'pass'
                      : this.lastSubmission.state === 'NOT_PASS'
                        ? 'fail'
                        : 'run'
              }">${escapeHtml(this.lastSubmission.state)}</span></div><strong>${escapeHtml(
                  formatSubmissionScore(this.lastSubmission),
              )}</strong></div><small>${escapeHtml(
                  this.lastSubmission.submission_id
                      ? `submission_id: ${this.lastSubmission.submission_id}`
                      : 'submission_id: unknown',
              )}</small></div>`
            : ''
    }
    <div class="download-box">
        <h3>Download PDF</h3>
        <div class="download-row">
            <input id="pdf-task-id" type="text" placeholder="A1-001" />
            <button id="download-pdf-btn">Download</button>
        </div>
        ${
            this.lastDownload
                ? `<div class="download-last"><small>Last file: ${escapeHtml(
                      this.lastDownload.task,
                  )}</small><button data-command="toiZero.openDownloadedPdf" data-path="${escapeHtml(
                      this.lastDownload.path,
                  )}" class="secondary">Open Last PDF</button></div>`
                : '<small class="muted">No PDF downloaded yet.</small>'
        }
        <div class="task-folders">${downloadTaskFolders}</div>
    </div>
    ${
        this.error
            ? `<div class="error"><p>${escapeHtml(this.error)}</p><div class="error-actions"><button data-command="toiZero.refreshStatus">Try Again</button><button data-command="toiZero.clearCredentials" class="secondary">Clear Login</button></div>${
                  this.errorDetails
                      ? `<details><summary>Technical details</summary><pre>${escapeHtml(
                            this.errorDetails,
                        )}</pre></details>`
                      : ''
              }</div>`
            : ''
    }
    <div class="grid">
        <div class="metric"><div>${summary ? `${summary.counted_passed_all_levels}/${summary.required_all_levels}` : '-'}</div><div>All counted</div></div>
        <div class="metric"><div>${summary ? `${summary.counted_passed_a2_a3}/${summary.required_a2_a3}` : '-'}</div><div>A2 + A3</div></div>
        <div class="metric"><div>${done ?? '-'}</div><div>Done</div></div>
        <div class="metric"><div>${low ?? '-'}/${todo ?? '-'}</div><div>Low / Todo</div></div>
    </div>
    <div class="actions">
        <button data-command="toiZero.refreshStatus">Refresh Status / Login</button>
        <button data-command="cph.runTestCases" class="secondary">Run Testcases</button>
        <button data-command="toiZero.downloadPdf" class="secondary">Download PDF</button>
        <button data-command="toiZero.submitActiveFile" class="secondary">Submit Active File</button>
        <button data-command="toiZero.checkSubmission" class="secondary">Check Submission Result</button>
        <button data-command="toiZero.openSolution" class="secondary">Open Solution</button>
        <button data-command="toiZero.showStatusJson" class="secondary">Open Status JSON</button>
        <button data-command="toiZero.clearCredentials" class="secondary">Clear Login</button>
    </div>
    <h3>Need Work</h3>
    <ul>${sampleTasks}</ul>
    <div class="footer-credit">Credits: PakinDioxide (solution reference), idkwhyiusethisname (implementation idea support)</div>
    <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button[data-command]').forEach((button) => {
        button.addEventListener('click', () => {
            vscode.postMessage({
                command: button.getAttribute('data-command'),
                task: button.getAttribute('data-task') || undefined,
                path: button.getAttribute('data-path') || undefined,
            });
        });
    });
    const downloadBtn = document.getElementById('download-pdf-btn');
    const taskInput = document.getElementById('pdf-task-id');
    if (downloadBtn && taskInput) {
        const submitDownload = () => {
            const value = taskInput.value.trim();
            if (!value) {
                return;
            }
            vscode.postMessage({
                command: 'toiZero.downloadPdf',
                task: value,
            });
        };
        downloadBtn.addEventListener('click', submitDownload);
        taskInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                submitDownload();
            }
        });
    }
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

const formatSubmissionScore = (result: ToiSubmissionResult) =>
    result.score === null || result.max_score === null
        ? 'score unknown'
        : `${result.score}/${result.max_score}`;

const formatSubmissionSummary = (result: ToiSubmissionResult) =>
    `${result.task}: ${result.state} (${formatSubmissionScore(result)})`;

interface ToiUiError {
    message: string;
    details?: string;
}

const toRawErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

const getLastMeaningfulLine = (raw: string) => {
    const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    return lines[lines.length - 1] || raw.trim();
};

const formatToiError = (error: unknown): ToiUiError => {
    const raw = toRawErrorMessage(error);
    const lastLine = getLastMeaningfulLine(raw);

    if (/\b502\b/i.test(raw) && /toi-coding\.informatics\.buu\.ac\.th/i.test(raw)) {
        return {
            message:
                'TOI Zero website is temporarily unavailable (HTTP 502). Please try again later.',
            details: lastLine,
        };
    }

    if (/TOI username is required|TOI password is required/i.test(raw)) {
        return {
            message: 'Login cancelled. Click Refresh Status to enter TOI credentials again.',
        };
    }

    if (/ENOENT|not recognized as an internal or external command/i.test(raw)) {
        return {
            message:
                'Python command was not found. Set toiZero.pythonPath in Settings (for example: python, py, or full python.exe path).',
            details: lastLine,
        };
    }

    if (/Traceback \(most recent call last\)/i.test(raw)) {
        return {
            message: 'TOI Zero request failed. See technical details for diagnostics.',
            details: raw,
        };
    }

    return {
        message: `TOI Zero request failed: ${lastLine}`,
        details: raw === lastLine ? undefined : raw,
    };
};

export default function registerToiZero(context: vscode.ExtensionContext) {
    const provider = new ToiZeroProvider();
    const dashboard = new ToiZeroDashboard();
    let cachedStatus: ToiStatusPayload | undefined;
    let lastDownloadedPdfPath: string | undefined;

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

    const waitForFinalSubmission = async (
        task: string,
        submissionId?: string,
        maxWaitSeconds = 90,
    ) => {
        const args = [
            '--check-submission',
            normalizeTaskId(task),
            '--wait',
            String(maxWaitSeconds),
            '--json',
        ];
        if (submissionId) {
            args.splice(2, 0, '--submission-id', submissionId);
        }
        return runPython<ToiSubmissionPayload>(await withCredentials(args));
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
                    const formatted = formatToiError(error);
                    dashboard.setError(formatted.message, formatted.details);
                    vscode.window.showErrorMessage(`TOI Zero: ${formatted.message}`);
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
        if (!cachedStatus) {
            vscode.window.showErrorMessage(
                'TOI Zero: Cannot open status JSON because status is not loaded.',
            );
            return;
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
            const normalizedTask = normalizeTaskId(task);
            dashboard.setBusy(true, `Downloading ${normalizedTask} PDF...`);
            const level = normalizedTask.split('-', 1)[0];
            const outputDir = path.join(getWorkspaceFolder(), 'toi-pdfs', level);
            const payload = await runPython<ToiDownloadPayload>(
                await withCredentials([
                    '--download',
                    normalizedTask,
                    '--download-dir',
                    outputDir,
                    '--json',
                ]),
            );
            const uri = vscode.Uri.file(payload.download.path);
            lastDownloadedPdfPath = payload.download.path;
            dashboard.setDownloaded(
                payload.download,
                `Downloaded ${normalizedTask} PDF.`,
            );
            await vscode.commands.executeCommand('vscode.open', uri);
        } catch (error) {
            const formatted = formatToiError(error);
            dashboard.setError(formatted.message, formatted.details);
            vscode.window.showErrorMessage(`TOI Zero: ${formatted.message}`);
        }
    };

    const openDownloadedPdf = async (pathArg?: unknown) => {
        const targetPath =
            (typeof pathArg === 'string' && pathArg.trim()) ||
            lastDownloadedPdfPath;
        if (!targetPath) {
            vscode.window.showInformationMessage(
                'No downloaded PDF yet. Use Download PDF first.',
            );
            return;
        }
        if (!fs.existsSync(targetPath)) {
            vscode.window.showErrorMessage(
                `TOI Zero: PDF file not found: ${targetPath}`,
            );
            return;
        }
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(targetPath));
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
                    '30',
                    '--json',
                ]),
            );

            let finalResult = payload.submission;
            if (!finalResult || !finalResult.done) {
                dashboard.setBusy(
                    true,
                    `Submitted ${payload.submit.task}. Waiting for grader result...`,
                );
                const checked = await waitForFinalSubmission(
                    payload.submit.task,
                    payload.submit.submission_id,
                );
                finalResult = checked.submission;
            }

            if (finalResult) {
                const summary = formatSubmissionSummary(finalResult);
                dashboard.setSubmissionResult(finalResult, `Submit result: ${summary}`);
                vscode.window.showInformationMessage(`TOI submit ${summary}`);
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
            const formatted = formatToiError(error);
            dashboard.setError(formatted.message, formatted.details);
            vscode.window.showErrorMessage(`TOI Zero: ${formatted.message}`);
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
            const summary = formatSubmissionSummary(result);
            vscode.window.showInformationMessage(`TOI ${summary}`);
            dashboard.setSubmissionResult(result, `Check result: ${summary}`);
        } catch (error) {
            const formatted = formatToiError(error);
            dashboard.setError(formatted.message, formatted.details);
            vscode.window.showErrorMessage(`TOI Zero: ${formatted.message}`);
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
            'Credits: GitHub PakinDioxide, idkwhyiusethisname',
        );
    };

    const clearCredentials = async () => {
        await context.secrets.delete(SECRET_USERNAME);
        await context.secrets.delete(SECRET_PASSWORD);
        cachedStatus = undefined;
        lastDownloadedPdfPath = undefined;
        provider.refresh([]);
        dashboard.clearState('Saved TOI login cleared.');
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
        vscode.commands.registerCommand('toiZero.openDownloadedPdf', openDownloadedPdf),
        vscode.commands.registerCommand('toiZero.submitActiveFile', submitActiveFile),
        vscode.commands.registerCommand('toiZero.checkSubmission', checkSubmission),
        vscode.commands.registerCommand('toiZero.openSolution', openSolution),
        vscode.commands.registerCommand('toiZero.clearCredentials', clearCredentials),
        vscode.commands.registerCommand('toiZero.pickTask', pickTaskActions),
    );
}
