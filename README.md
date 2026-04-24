# Competitive Programming Helper (cph)

Quickly compile, run and judge competitive programming problems in VS Code.
Automatically download testcases , or write & test your own problems. Once you
are done, easily submit your solutions directly with the click of a button!

Cph supports a large number of popular platforms like Codeforces, Codechef,
TopCoder etc. with the help of competitive companion browser extension

![Screenshot](screenshots/screenshot-main.png)

## Quick start

1. [Install cph](https://marketplace.visualstudio.com/items?itemName=DivyanshuAgrawal.competitive-programming-helper)
   in VS Code and open any folder.
1. [Install competitive companion](https://github.com/jmerle/competitive-companion#readme)
   in your browser.
1. Use Companion by pressing the green plus (+) circle from the browser toolbar
   when visiting any problem page.
1. The file opens in VS Code with testcases preloaded. Press
   <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> to run them.

-   (Optional) Install the [cph-submit](https://github.com/agrawal-d/cph-submit)
    browser extension to enable submitting directly on CodeForces.
-   (Optional) Install submit client and config file from the
    [Kattis help page](https://open.kattis.com/help/submit) after logging in.

You can also use this extension locally, just open any supported file and press
'Run Testcases' (or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd>) to manually
enter testcases.

[![See detailed user guide](https://img.shields.io/badge/-Read%20detailed%20usage%20guide-blue?style=for-the-badge)](docs/user-guide.md)

## Features

-   Automatic compilation with display for compilation errors.
-   Intelligent judge with support for signals, timeouts and runtime errors.
-   Works with Competitive Companion.
-   [Codeforces auto-submit](https://github.com/agrawal-d/cph-submit)
    integration.
-   [Kattis auto-submit](docs/user-guide.md) integration.
-   Works locally for your own problems.
-   Support for several languages.

## TOI Zero Integration

This fork adds TOI Zero workflow commands for
`toi-coding.informatics.buu.ac.th/00-pre-toi`.

Open the `TOI Zero` activity bar icon to use the dashboard. It shows the
connection state, pass-count summary, unfinished tasks, and large buttons for
the common actions. If login or the grader server fails, the dashboard shows
`TOI Zero server can't connect` with the underlying error.

Available functions:

-   `TOI Zero: Refresh Status` - login, fetch the overview page, and list all
    A1/A2/A3 tasks in the TOI Zero tree view.
-   `TOI Zero: Show Status JSON` - open the full parsed JSON status, including
    summary, tasks, counted tasks, excluded tasks, and scores.
-   `TOI Zero: Download PDF` - download a selected task statement PDF into
    `toi-pdfs/` and open it in VS Code.
-   `TOI Zero: Submit Active File` - submit the currently opened source file to
    the selected task. The extension maps `.cpp/.cc/.cxx` to `C++17 / g++`,
    `.c` to `C11 / gcc`, and `.py` to `Python 3 / CPython`.
-   `TOI Zero: Check Submission Result` - fetch the latest selected-task
    submission page, wait briefly if the grader is still running, and report
    `PASS`, `NOT_PASS`, `RUNNING`, or `UNKNOWN` with the score when available.
-   `TOI Zero: Open Solution (PakinDioxide)` - open a GitHub code search for
    the selected task scoped to `PakinDioxide`.
-   `TOI Zero: Clear Saved Login` - remove saved TOI username/password from VS
    Code Secret Storage.

The TOI Zero tree states are:

-   `DONE` - score is at least 80 and the task is counted.
-   `LOW` - submitted, but score is below 80.
-   `TODO` - no passing score yet.
-   `EXCLUDED` - task is excluded from the 2569 criteria.
-   `EXCLUDED_OK` - task is excluded, but already has a passing score.

Credit for the solution shortcut: GitHub `PakinDioxide`.

## Supported Languages

-   C++
-   C
-   C#
-   Rust
-   Go
-   Haskell
-   Python
-   Ruby
-   Java
-   JavaScript (Node.js)

## Contributing

You can contribute to this extension in many ways:

-   File bug reports by creating issues.
-   Develop this extension further - see [developer guide](docs/dev-guide.md).
-   Spreading the word about this extension.

**Before creating a Pull Request, please create an issue to discuss the
approach. It makes reviewing and accepting the PR much easier.**

## Telemetry

To show live user count, the extension sends a request to the server every few
seconds. No information is sent with the request.

## License

Copyright (C) 2019 - Present Divyanshu Agrawal

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with
this program. If not, see https://www.gnu.org/licenses/.
