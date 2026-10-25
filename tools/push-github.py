#!/usr/bin/env python3
"""push-github.py — 通过 gh api (Git Data API) 推送本目录到 GitHub
绕过 git https 被网络干扰的问题。用法: python3 tools/push-github.py "commit message"
"""
import base64
import json
import os
import subprocess
import sys

REPO = "yigenfeng0707-netizen/yanbaoxia-web"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {"node_modules", ".git", "data", "__pycache__"}
SKIP_FILES = {".alipay-sandbox.json", "env.production", ".DS_Store", "deploy.log"}


def gh(endpoint, method="GET", body=None):
    cmd = ["gh", "api", endpoint]
    if method != "GET":
        cmd += ["-X", method]
    tmp = None
    if body is not None:
        tmp = "/tmp/_gh_body.json"
        with open(tmp, "w") as f:
            json.dump(body, f)
        cmd += ["--input", tmp]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"gh {method} {endpoint}: {r.stderr[:300]}")
    return json.loads(r.stdout) if r.stdout.strip() else {}


def collect_files():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".git")]
        for fn in filenames:
            if fn in SKIP_FILES or fn.endswith(".log"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
            with open(full, "rb") as f:
                content = base64.b64encode(f.read()).decode()
            out.append((rel, content))
    return out


def main():
    msg = sys.argv[1] if len(sys.argv) > 1 else "update"
    files = collect_files()
    print(f"待推送文件数: {len(files)}")
    tree = []
    for rel, content in files:
        blob = gh(f"/repos/{REPO}/git/blobs", "POST", body={"content": content, "encoding": "base64"})
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print(f"  blob {rel}")

    base_tree, parent = None, None
    try:
        ref = gh(f"/repos/{REPO}/git/ref/heads/main")
        parent, base_tree = ref["object"]["sha"], None
        commit0 = gh(f"/repos/{REPO}/git/commits/{parent}")
        base_tree = commit0["tree"]["sha"]
    except RuntimeError:
        print("空仓库，创建初始提交")

    body = {"tree": tree}
    if base_tree:
        body["base_tree"] = base_tree
    new_tree = gh(f"/repos/{REPO}/git/trees", "POST", body=body)

    body = {"message": msg, "tree": new_tree["sha"]}
    if parent:
        body["parents"] = [parent]
    commit = gh(f"/repos/{REPO}/git/commits", "POST", body=body)

    try:
        gh(f"/repos/{REPO}/git/refs/heads/main", "PATCH", body={"sha": commit["sha"], "force": True})
        print(f"已更新 main -> {commit['sha'][:10]}")
    except RuntimeError:
        gh(f"/repos/{REPO}/git/refs", "POST", body={"ref": "refs/heads/main", "sha": commit["sha"]})
        print(f"已创建 main -> {commit['sha'][:10]}")
    print("完成: https://github.com/" + REPO)


if __name__ == "__main__":
    main()
