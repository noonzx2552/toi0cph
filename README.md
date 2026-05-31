# TOI Zero Helper for CPH

An upgraded VS Code workflow for competitive programming, built on top of `Competitive Programming Helper (CPH)` and tailored for `TOI Zero`.

![Screenshot](screenshots/screenshot-main.png)

## Overview

This project is a fork of CPH that keeps the core competitive programming features you already know:

- Run testcases locally
- Import problems with Competitive Companion
- Compile, judge, and submit directly from VS Code
- Work across multiple languages

It also adds a dedicated `TOI Zero` workflow:

- View task status and scores from the sidebar
- Download statement PDFs for selected tasks
- Export passing source files as a reusable set
- Submit the active file or batch-submit all passing tasks
- Check the latest submission result without leaving the editor

## Highlights

- A dashboard-style `TOI Zero` panel for fast status checks
- Tree view grouped by `A1`, `A2`, and `A3`
- Clear task states such as `DONE`, `LOW`, `TODO`, and `EXCLUDED`
- Local cache for passing source files in `.toi-zero/passed-sources/`
- Exported sources in `toi-passed-code/`
- Direct access to reference solutions from `PakinDioxide/TOI-zero`
- Submit from the file that is currently open
- Built-in support for `C`, `C++`, and `Python` mappings used by TOI

## Quick Start

1. Install this extension in VS Code and open your workspace.
2. Open the `TOI Zero` view from the Activity Bar.
3. Run `TOI Zero: Refresh Status` to log in and load the task list.
4. Pick a task and use the action you need.

To test code locally:

- Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> to run testcases
- Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> to submit to Codeforces
- Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> to focus the TOI Zero testcases view

## TOI Zero Workflow

Common commands:

- `TOI Zero: Refresh Status` - log in and fetch the latest TOI Zero status
- `TOI Zero: Show Status JSON` - open the parsed status as JSON
- `TOI Zero: Show Solved Scores` - list solved tasks with scores
- `TOI Zero: Download PDF` - download the statement PDF for a selected task
- `TOI Zero: Download Passed Code` - export source files for passing tasks
- `TOI Zero: Submit Active File` - submit the file currently open in the editor
- `TOI Zero: Submit All Passed` - submit all exported passing source files in one batch
- `TOI Zero: Check Submission Result` - check the latest submission result for a task
- `TOI Zero: Open Solution (PakinDioxide)` - open the reference solution
- `TOI Zero: Clear Saved Login` - remove stored TOI username and password

Task states shown in the tree:

- `DONE` - counted and at or above the passing threshold
- `LOW` - submitted, but still below the passing threshold
- `TODO` - no passing score yet
- `EXCLUDED` - excluded from the criteria
- `EXCLUDED_OK` - excluded, but already has a passing score

## Files and Folders

- `.toi-zero/passed-sources/` - local cache of passing source files
- `toi-passed-code/` - exported source files ready for reuse
- `toi-pdfs/` - downloaded statement PDFs

## Supported Languages

- C++
- C
- C#
- Rust
- Go
- Haskell
- Python
- Ruby
- Java
- JavaScript

## Settings Worth Knowing

Open VS Code `Settings` and search for `Competitive Programming Helper` or `TOI Zero`. Useful options include:

- `cph.general.timeOut` - testcase timeout
- `cph.general.defaultLanguage` - default language for newly imported problems
- `cph.general.menuChoices` - language order in the import menu
- `cph.language.*.Command` - compiler/runtime command for each language
- `toiZero.pythonPath` - Python command or path used by the TOI Zero integration

## Who It's For

- People who solve competitive programming problems in VS Code every day
- People who need to manage many TOI Zero tasks at once
- People who want local judging and TOI workflow in one place

## Credits

This project is based on `Competitive Programming Helper` by `Divyanshu Agrawal`.
The TOI Zero workflow is connected to resources from `PakinDioxide/TOI-zero`.

## License

GPL-3.0-or-later

