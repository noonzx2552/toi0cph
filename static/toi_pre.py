import argparse
import getpass
import html as html_lib
import json
import os
import re
import time
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urljoin, urlparse

import requests


BASE_URL = "https://toi-coding.informatics.buu.ac.th/00-pre-toi"
LOGIN_URL = urljoin(BASE_URL + "/", "login")
PASSING_SCORE = 80
TASK_ID_PATTERN = re.compile(r"A[123]-\d{3}")
EXCLUDED_TASKS = {
    "A1-002",
    "A1-004",
    "A1-006",
    "A1-008",
    "A1-010",
    "A1-012",
    "A1-014",
    "A1-016",
    "A1-018",
    "A1-020",
    "A1-022",
    "A1-024",
    "A1-026",
    "A1-028",
    "A1-030",
    "A1-032",
    "A1-034",
    "A1-036",
    "A1-038",
    "A1-040",
    "A2-002",
    "A2-004",
    "A2-006",
    "A2-008",
    "A2-010",
    "A2-012",
    "A2-014",
    "A2-016",
    "A2-018",
    "A2-020",
    "A2-022",
    "A2-024",
    "A2-026",
    "A2-028",
    "A2-030",
    "A2-032",
    "A2-044",
    "A2-057",
}
LANGUAGES = {
    "cpp": ("C++17 / g++", "cpp", "text/x-c++src"),
    "c++": ("C++17 / g++", "cpp", "text/x-c++src"),
    "c++17": ("C++17 / g++", "cpp", "text/x-c++src"),
    "c++17 / g++": ("C++17 / g++", "cpp", "text/x-c++src"),
    "c": ("C11 / gcc", "c", "text/x-csrc"),
    "c11": ("C11 / gcc", "c", "text/x-csrc"),
    "c11 / gcc": ("C11 / gcc", "c", "text/x-csrc"),
    "py": ("Python 3 / CPython", "py", "text/x-python"),
    "python": ("Python 3 / CPython", "py", "text/x-python"),
    "python3": ("Python 3 / CPython", "py", "text/x-python"),
    "python 3": ("Python 3 / CPython", "py", "text/x-python"),
    "python3 / cpython": ("Python 3 / CPython", "py", "text/x-python"),
    "python 3 / cpython": ("Python 3 / CPython", "py", "text/x-python"),
}


def extract_xsrf(html: str, session: requests.Session) -> str:
    match = re.search(
        r'<input[^>]+name=["\']_xsrf["\'][^>]+value=["\']([^"\']+)["\']',
        html,
        re.IGNORECASE,
    )
    if match:
        return match.group(1)

    cookie_value = session.cookies.get("_xsrf")
    if cookie_value:
        return cookie_value

    raise RuntimeError("Cannot find _xsrf token from page or cookie")


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/147.0.0.0 Safari/537.36"
            ),
            "Origin": "https://toi-coding.informatics.buu.ac.th",
            "Referer": BASE_URL,
        }
    )
    return session


def login(
    session: requests.Session, username: str, password: str
) -> tuple[requests.Response, str]:
    page = session.get(BASE_URL, timeout=20)
    page.raise_for_status()
    xsrf = extract_xsrf(page.text, session)

    response = session.post(
        LOGIN_URL,
        data={"_xsrf": xsrf, "username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        allow_redirects=False,
        timeout=20,
    )

    set_cookie = response.headers.get("Set-Cookie", "")
    cookies = SimpleCookie()
    cookies.load(set_cookie)

    login_cookie = cookies.get("00-pre-toi_login")
    if login_cookie is None:
        raise RuntimeError(
            "Login cookie not found. Check username/password or response status."
        )

    return response, login_cookie.value


def normalize_language(language: str) -> tuple[str, str, str]:
    normalized = re.sub(r"\s+", " ", language.strip().lower())
    if normalized in LANGUAGES:
        return LANGUAGES[normalized]

    valid = "C++17 / g++, C11 / gcc, Python 3 / CPython"
    raise ValueError(f"Unsupported language: {language}. Use one of: {valid}")


def read_code_from_stdin() -> str:
    print("Paste code below. End with a line that contains only EOF:")
    lines = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line == "EOF":
            break
        lines.append(line)
    return "\n".join(lines) + "\n"


def submit_code(
    session: requests.Session, task: str, language: str, code: str
) -> requests.Response:
    language_name, extension, mime_type = normalize_language(language)
    task = normalize_task_id(task)
    submissions_url = f"{BASE_URL}/tasks/{task}/submissions"
    submit_url = f"{BASE_URL}/tasks/{task}/submit"

    page = session.get(submissions_url, timeout=20)
    page.raise_for_status()
    xsrf = extract_xsrf(page.text, session)

    filename = f"{task}.{extension}"
    files = {
        f"{task}.%l": (filename, code, mime_type),
    }
    data = {
        "_xsrf": xsrf,
        "language": language_name,
    }

    return session.post(
        submit_url,
        data=data,
        files=files,
        headers={"Referer": submissions_url},
        allow_redirects=False,
        timeout=30,
    )


def extract_submission_id(location: str) -> str | None:
    if not location:
        return None
    parsed = urlparse(location)
    query = parse_qs(parsed.query)
    values = query.get("submission_id")
    if values:
        return values[0]
    match = re.search(r"submission_id=([^&\s]+)", location)
    if match:
        return match.group(1)
    return None


def parse_submission_result(html: str) -> dict[str, object]:
    text = clean_html_cell(html)
    score_matches = [
        (int(score), int(max_score))
        for score, max_score in re.findall(r"(\d+)\s*/\s*(\d+)", text)
    ]
    score = None
    max_score = None
    if score_matches:
        score, max_score = max(score_matches, key=lambda item: item[0])

    lower_text = text.lower()
    running_words = (
        "compiling",
        "evaluating",
        "scoring",
        "running",
        "pending",
        "waiting",
        "queued",
    )
    done = score is not None or any(
        word in lower_text
        for word in ("compilation failed", "accepted", "wrong answer", "evaluated")
    )
    running = not done and any(word in lower_text for word in running_words)

    if score is None and "compilation failed" in lower_text:
        score = 0
        max_score = 100

    passed = score is not None and score >= PASSING_SCORE
    if passed:
        state = "PASS"
    elif running:
        state = "RUNNING"
    elif score is None:
        state = "UNKNOWN"
    else:
        state = "NOT_PASS"

    return {
        "score": score,
        "max_score": max_score,
        "passed": passed,
        "state": state,
        "done": state in {"PASS", "NOT_PASS"},
        "text_preview": text[:500],
    }


def check_submission(
    session: requests.Session, task: str, submission_id: str | None = None
) -> dict[str, object]:
    task = normalize_task_id(task)
    submissions_url = f"{BASE_URL}/tasks/{task}/submissions"
    params = {"submission_id": submission_id} if submission_id else None
    response = session.get(
        submissions_url,
        params=params,
        headers={"Referer": submissions_url},
        timeout=20,
    )
    response.raise_for_status()
    result = parse_submission_result(response.text)
    result["task"] = task
    result["submission_id"] = submission_id
    result["url"] = response.url
    return result


def wait_submission(
    session: requests.Session,
    task: str,
    submission_id: str | None,
    timeout_seconds: int,
    interval_seconds: float = 2.0,
) -> dict[str, object]:
    deadline = time.time() + timeout_seconds
    last_result = check_submission(session, task, submission_id)
    while not last_result.get("done") and time.time() < deadline:
        time.sleep(interval_seconds)
        last_result = check_submission(session, task, submission_id)
    last_result["timed_out"] = not last_result.get("done")
    return last_result


def normalize_task_id(task: str) -> str:
    task = task.strip().upper()
    if not TASK_ID_PATTERN.fullmatch(task):
        raise ValueError("Invalid task ID. Example: A1-001")
    return task


def download_statement_pdf(
    session: requests.Session, task: str, output_dir: str = "."
) -> str:
    task = normalize_task_id(task)
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{task}.pdf")
    url = f"{BASE_URL}/tasks/{task}/attachments/{task}.pdf"
    referer = f"{BASE_URL}/tasks/{task}/description"

    response = session.get(url, headers={"Referer": referer}, timeout=30)
    response.raise_for_status()

    with open(output_path, "wb") as pdf_file:
        pdf_file.write(response.content)

    return os.path.abspath(output_path)


def clean_html_cell(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_task_overview(html: str) -> list[dict[str, object]]:
    table_match = re.search(
        r'<table[^>]*class=["\'][^"\']*main_task_list[^"\']*["\'][^>]*>(.*?)</table>',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if not table_match:
        raise RuntimeError("Cannot find task overview table")

    tasks = []
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table_match.group(1), re.DOTALL)
    for row in rows:
        cells = re.findall(r"<(?:td|th)\b[^>]*>(.*?)</(?:td|th)>", row, re.DOTALL)
        if len(cells) < 3:
            continue

        score_text = clean_html_cell(cells[0])
        task_id = clean_html_cell(cells[1])
        name = clean_html_cell(cells[2])
        score_match = re.search(r"(\d+)\s*/\s*(\d+)", score_text)
        if not score_match or not TASK_ID_PATTERN.fullmatch(task_id):
            continue

        score = int(score_match.group(1))
        max_score = int(score_match.group(2))
        tasks.append(
            {
                "task": task_id,
                "name": name,
                "score": score,
                "max_score": max_score,
                "level": task_id.split("-", 1)[0],
                "passed": score >= PASSING_SCORE,
                "excluded": task_id in EXCLUDED_TASKS,
            }
        )

    return tasks


def get_task_status(session: requests.Session) -> list[dict[str, object]]:
    response = session.get(BASE_URL, timeout=20)
    response.raise_for_status()
    return parse_task_overview(response.text)


def print_task_status(tasks: list[dict[str, object]]) -> None:
    counted_passed = [task for task in tasks if task["passed"] and not task["excluded"]]
    counted_a2_a3 = [
        task for task in counted_passed if task["level"] in {"A2", "A3"}
    ]
    excluded_passed = [task for task in tasks if task["passed"] and task["excluded"]]

    all_ok = len(counted_passed) >= 40
    a2_a3_ok = len(counted_a2_a3) >= 20

    print("STATUS")
    print(f"passed counted all levels: {len(counted_passed)} / 40")
    print(f"passed counted A2+A3: {len(counted_a2_a3)} / 20")
    print(f"excluded but passed: {len(excluded_passed)}")
    print(f"criteria: {'PASS' if all_ok and a2_a3_ok else 'NOT PASS'}")
    print()

    by_level = {}
    for task in counted_passed:
        by_level.setdefault(task["level"], []).append(task["task"])

    for level in ("A1", "A2", "A3"):
        values = by_level.get(level, [])
        print(f"{level} counted passed ({len(values)}): {', '.join(values) or '-'}")

    not_passed_counted = [
        task for task in tasks if not task["passed"] and not task["excluded"]
    ]
    print()
    print(f"counted tasks below {PASSING_SCORE}: {len(not_passed_counted)}")
    for task in not_passed_counted:
        print(f"{task['task']:7} {task['score']:3} / {task['max_score']}  {task['name']}")


def build_status_payload(
    tasks: list[dict[str, object]], token: str | None = None
) -> dict[str, object]:
    counted_passed = [task for task in tasks if task["passed"] and not task["excluded"]]
    counted_a2_a3 = [
        task for task in counted_passed if task["level"] in {"A2", "A3"}
    ]
    excluded_passed = [task for task in tasks if task["passed"] and task["excluded"]]
    counted_below_80 = [
        task for task in tasks if not task["passed"] and not task["excluded"]
    ]

    by_level = {}
    for level in ("A1", "A2", "A3"):
        by_level[level] = [
            task["task"] for task in counted_passed if task["level"] == level
        ]

    output_tasks = []
    for task in tasks:
        output_tasks.append(
            {
                "task": task["task"],
                "name": task["name"],
                "score": task["score"],
                "max_score": task["max_score"],
                "level": task["level"],
                "passed": task["passed"],
                "excluded": task["excluded"],
                "state": task_state(task),
                "counted": not task["excluded"],
            }
        )

    payload = {
        "summary": {
            "passing_score": PASSING_SCORE,
            "counted_passed_all_levels": len(counted_passed),
            "required_all_levels": 40,
            "counted_passed_a2_a3": len(counted_a2_a3),
            "required_a2_a3": 20,
            "excluded_passed": len(excluded_passed),
            "criteria_pass": len(counted_passed) >= 40
            and len(counted_a2_a3) >= 20,
        },
        "by_level": by_level,
        "counted_below_80": [
            {
                "task": task["task"],
                "name": task["name"],
                "score": task["score"],
                "max_score": task["max_score"],
                "level": task["level"],
                "state": task_state(task),
            }
            for task in counted_below_80
        ],
        "tasks": output_tasks,
    }
    if token is not None:
        payload["login_token"] = token
    return payload


def print_json(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=True, indent=2))


def task_state(task: dict[str, object]) -> str:
    if task["excluded"] and task["passed"]:
        return "EXCLUDED_OK"
    if task["excluded"]:
        return "EXCLUDED"
    if task["passed"]:
        return "DONE"
    if task["score"]:
        return "LOW"
    return "TODO"


def shorten(text: str, max_width: int) -> str:
    if len(text) <= max_width:
        return text
    return text[: max_width - 3] + "..."


def print_task_table(tasks: list[dict[str, object]]) -> None:
    print("TASK TABLE")
    print("DONE = score >= 80 and counted, LOW = submitted but below 80")
    print("EXCLUDED = not counted for 2569 criteria")
    print()
    print(f"{'Task':7} {'Score':9} {'State':12} Name")
    print(f"{'-' * 7} {'-' * 9} {'-' * 12} {'-' * 45}")
    for task in tasks:
        score = f"{task['score']}/{task['max_score']}"
        print(
            f"{task['task']:7} {score:9} {task_state(task):12} "
            f"{shorten(str(task['name']), 45)}"
        )
    print()
    print_task_status(tasks)
    print()


def find_task(tasks: list[dict[str, object]], task_id: str) -> dict[str, object] | None:
    task_id = normalize_task_id(task_id)
    for task in tasks:
        if task["task"] == task_id:
            return task
    return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Login to TOI pre site, print token, and optionally submit code."
    )
    parser.add_argument("-u", "--username", help="TOI username")
    parser.add_argument("-p", "--password", help="TOI password")
    parser.add_argument("-t", "--task", help="Task ID, for example A1-001")
    parser.add_argument(
        "--check-submission",
        metavar="TASK",
        help="Check latest or selected submission result for a task",
    )
    parser.add_argument(
        "--submission-id",
        help="Submission ID used with --check-submission",
    )
    parser.add_argument(
        "--wait",
        type=int,
        default=0,
        help="Wait this many seconds for --check-submission to finish",
    )
    parser.add_argument(
        "--wait-submit-result",
        type=int,
        default=0,
        help="After submit, wait this many seconds and include submission result",
    )
    parser.add_argument(
        "--download",
        metavar="TASK",
        help="Download statement PDF for a task, for example A1-001",
    )
    parser.add_argument(
        "--download-dir",
        default=".",
        help="Directory for downloaded PDFs",
    )
    parser.add_argument(
        "--download-only",
        action="store_true",
        help="Download PDF and exit without submit prompt",
    )
    parser.add_argument(
        "--no-table",
        action="store_true",
        help="Do not print task table before interactive prompts",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Print solved task status and criteria progress, then exit",
    )
    parser.add_argument(
        "-l",
        "--language",
        default="Python 3 / CPython",
        help="C++17 / g++, C11 / gcc, or Python 3 / CPython",
    )
    parser.add_argument("-f", "--file", help="Source code file to submit")
    parser.add_argument(
        "--token-only",
        action="store_true",
        help="Only print login token, do not ask for submit data",
    )
    parser.add_argument(
        "--show-response",
        action="store_true",
        help="Print login and submit response details",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON output",
    )
    args = parser.parse_args()

    username = args.username or input("username: ").strip()
    password = args.password or getpass.getpass("password: ")

    session = make_session()
    response, token = login(session, username, password)

    if args.show_response and not args.json:
        print(f"LOGIN HTTP {response.status_code} {response.reason}")
        print(f"Location: {response.headers.get('Location', '')}")
        print(f"Set-Cookie: {response.headers.get('Set-Cookie', '')}")
        print()

    tasks = None
    should_load_status = (
        args.status
        or args.json
        or args.download
        or args.check_submission
        or (not args.token_only and not args.no_table and args.task is None)
    )
    if should_load_status:
        tasks = get_task_status(session)

    if args.status:
        if args.json:
            print_json(build_status_payload(tasks or [], token))
        else:
            print_task_table(tasks or [])
        return

    if args.json and args.task is None and args.download is None and not args.token_only:
        print_json(build_status_payload(tasks or [], token))
        return

    if args.token_only:
        if args.json:
            print_json({"login_token": token})
        else:
            print(token)
        return

    if args.check_submission:
        if args.wait > 0:
            result = wait_submission(
                session,
                args.check_submission,
                args.submission_id,
                args.wait,
            )
        else:
            result = check_submission(
                session, args.check_submission, args.submission_id
            )
        if args.json:
            print_json({"login_token": token, "submission": result})
        else:
            print(
                f"{result['task']} {result['state']} "
                f"{result['score']} / {result['max_score']}"
            )
        return

    if tasks is not None and not args.no_table and args.task is None and not args.json:
        print_task_table(tasks)

    if not args.json:
        print(f"login token: {token}")

    if args.download:
        if tasks is not None and find_task(tasks, args.download) is None:
            raise ValueError(f"Task not found in overview: {args.download}")
        pdf_path = download_statement_pdf(session, args.download, args.download_dir)
        if args.json:
            print_json(
                {
                    "login_token": token,
                    "download": {
                        "task": normalize_task_id(args.download),
                        "path": pdf_path,
                    },
                    "status": build_status_payload(tasks or [])["summary"],
                }
            )
        else:
            print(f"downloaded: {pdf_path}")
        if args.download_only or args.json:
            return
    elif args.task is None:
        download_task = input("download PDF task ID (blank = skip): ").strip()
        if download_task:
            if tasks is not None and find_task(tasks, download_task) is None:
                raise ValueError(f"Task not found in overview: {download_task}")
            pdf_path = download_statement_pdf(session, download_task, args.download_dir)
            print(f"downloaded: {pdf_path}")

    task = args.task
    if task is None:
        task = input("task ID (blank = skip submit): ").strip()
    if not task:
        return
    task = normalize_task_id(task)
    if tasks is not None and find_task(tasks, task) is None:
        raise ValueError(f"Task not found in overview: {task}")

    if args.file:
        with open(args.file, "r", encoding="utf-8") as source_file:
            code = source_file.read()
    else:
        code = read_code_from_stdin()

    submit_response = submit_code(session, task, args.language, code)
    submission_id = extract_submission_id(submit_response.headers.get("Location", ""))
    submission_result = None
    if args.wait_submit_result > 0:
        submission_result = wait_submission(
            session, task, submission_id, args.wait_submit_result
        )

    if args.json:
        payload = {
            "login_token": token,
            "submit": {
                "task": task,
                "status_code": submit_response.status_code,
                "reason": submit_response.reason,
                "location": submit_response.headers.get("Location", ""),
                "submission_id": submission_id,
            }
        }
        if submission_result is not None:
            payload["submission"] = submission_result
        print_json(payload)
    elif args.show_response:
        print(f"SUBMIT HTTP {submit_response.status_code} {submit_response.reason}")
        print(f"Location: {submit_response.headers.get('Location', '')}")
    else:
        print(f"submit: HTTP {submit_response.status_code} {submit_response.reason}")


if __name__ == "__main__":
    main()
