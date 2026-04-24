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

export default function registerToiZero(context: vscode.ExtensionContext) {
    const provider = new ToiZeroProvider();
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
                cachedStatus = await runPython<ToiStatusPayload>(
                    await withCredentials(['--status', '--json']),
                );
                provider.refresh(cachedStatus.tasks);
                const summary = cachedStatus.summary;
                vscode.window.showInformationMessage(
                    `TOI Zero: ${summary.counted_passed_all_levels}/${summary.required_all_levels} all, ${summary.counted_passed_a2_a3}/${summary.required_a2_a3} A2+A3, criteria ${summary.criteria_pass ? 'PASS' : 'NOT PASS'}.`,
                );
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
        const task =
            taskArgumentToId(taskArg) ||
            (await pickTaskId('Download TOI statement PDF'));
        if (!task) {
            return;
        }
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
        await vscode.commands.executeCommand('vscode.open', uri);
    };

    const submitActiveFile = async (taskArg?: unknown) => {
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
        } else {
            vscode.window.showInformationMessage(
                `TOI submit ${payload.submit.task}: HTTP ${payload.submit.status_code} ${payload.submit.reason}`,
            );
        }
        await refreshStatus();
    };

    const checkSubmission = async (taskArg?: unknown) => {
        const task =
            taskArgumentToId(taskArg) ||
            taskFromActiveFile() ||
            (await pickTaskId('Check TOI submission result'));
        if (!task) {
            return;
        }
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
