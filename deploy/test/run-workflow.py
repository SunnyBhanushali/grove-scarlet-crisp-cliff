#!/usr/bin/env python3
"""
Run one of .github/workflows/*.yml locally, step by step, the way a GitHub
runner would — used to test the pipeline against the throwaway VPS from
vps-sim-setup.sh. It executes the YAML's own `run:` scripts verbatim with
`bash --noprofile --norc -eo pipefail`, expands `${{ … }}`, honours `if:`,
GITHUB_ENV / GITHUB_OUTPUT / GITHUB_STEP_SUMMARY, runs the local composite
action, and turns `actions/checkout` into a fresh clone of this repo at the ref.

  run-workflow.py <workflow.yml> --work DIR --secrets secrets.json
                  [--event push|workflow_dispatch] [--ref BRANCH] [--input k=v]
                  [--env NAME=VALUE]   (overrides workflow env, e.g. LIVE_URL)

Exit code 0 = the job succeeded, 1 = it failed (like the Actions UI).
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile
import yaml

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class Ctx:
    def __init__(self, data):
        self.data = data
        self.job_status = "success"
        self.steps = {}

    def lookup(self, path):
        cur = self.data
        for part in path.split("."):
            if isinstance(cur, dict):
                cur = cur.get(part, "")
            else:
                return ""
        return cur

    def evaluate(self, expr):
        expr = expr.strip()
        # string literals out of the way first
        lits = []
        def keep(m):
            lits.append(m.group(1).replace("''", "'"))
            return f"__L{len(lits)-1}__"
        e = re.sub(r"'((?:[^']|'')*)'", keep, expr)
        e = e.replace("&&", " and ").replace("||", " or ").replace("!=", " __NE__ ").replace("!", " not ").replace(" __NE__ ", " != ")
        e = re.sub(r"\bfailure\(\)", "(__job == 'failure')", e)
        e = re.sub(r"\bsuccess\(\)", "(__job == 'success')", e)
        e = re.sub(r"\balways\(\)", "True", e)
        def name(m):
            return f"__get({m.group(0)!r})"
        e = re.sub(r"\b(?:secrets|inputs|github|env|steps|job|vars)(?:\.[A-Za-z_][A-Za-z0-9_-]*)+", name, e)
        for i, s in enumerate(lits):
            e = e.replace(f"__L{i}__", repr(s))
        def get(path):
            if path == "job.status":
                return self.job_status
            if path.startswith("steps."):
                _, sid, field = path.split(".", 2)
                return self.steps.get(sid, {}).get(field, "")
            return self.lookup(path)
        return eval(e, {"__get": get, "__job": self.job_status, "True": True})

    def expand(self, text):
        if not isinstance(text, str):
            return text
        def rep(m):
            v = self.evaluate(m.group(1))
            if v is True:
                return "true"
            if v is False or v is None:
                return "" if v is None else "false"
            return str(v)
        return re.sub(r"\$\{\{(.*?)\}\}", rep, text, flags=re.S)


def read_kv(path):
    out = {}
    if not os.path.exists(path):
        return out
    lines = open(path).read().splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)<<(.+)$", line)
        if m:
            key, delim, buf = m.group(1), m.group(2), []
            i += 1
            while i < len(lines) and lines[i] != delim:
                buf.append(lines[i]); i += 1
            out[key] = "\n".join(buf)
        elif "=" in line:
            k, v = line.split("=", 1)
            out[k] = v
        i += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workflow")
    ap.add_argument("--work", required=True)
    ap.add_argument("--secrets", required=True)
    ap.add_argument("--event", default="push")
    ap.add_argument("--ref", default="")
    ap.add_argument("--input", action="append", default=[])
    ap.add_argument("--env", action="append", default=[])
    a = ap.parse_args()

    wf = yaml.safe_load(open(a.workflow))
    on = wf.get(True) or wf.get("on")  # PyYAML reads `on:` as True
    secrets = json.load(open(a.secrets))
    inputs = {}
    if a.event == "workflow_dispatch":
        for k, spec in ((on.get("workflow_dispatch") or {}).get("inputs") or {}).items():
            inputs[k] = str(spec.get("default", ""))
    for kv in a.input:
        k, v = kv.split("=", 1)
        inputs[k] = v
    ref_name = a.ref or subprocess.check_output(["git", "-C", REPO, "rev-parse", "--abbrev-ref", "HEAD"], text=True).strip()
    sha = subprocess.check_output(["git", "-C", REPO, "rev-parse", ref_name], text=True).strip()

    os.makedirs(a.work, exist_ok=True)
    run_dir = tempfile.mkdtemp(prefix="run-", dir=a.work)
    # ssh reads ~/.ssh from the passwd home (not $HOME): run this as a
    # dedicated throwaway user, like a GitHub runner, and start it clean.
    home = os.path.expanduser("~" + os.environ.get("USER", ""))
    shutil.rmtree(os.path.join(home, ".ssh"), ignore_errors=True)
    ws = os.path.join(run_dir, "workspace")
    files = {n: os.path.join(run_dir, n) for n in ("env", "output", "summary")}
    for f in files.values():
        open(f, "w").close()

    job_name, job = next(iter(wf["jobs"].items()))
    wf_env = {**(wf.get("env") or {})}
    for kv in a.env:
        k, v = kv.split("=", 1)
        wf_env[k] = v
    ctx = Ctx({"secrets": secrets, "inputs": inputs, "vars": {},
               "github": {"event_name": a.event, "sha": sha, "ref_name": ref_name, "workspace": ws}})
    shell = ["bash", "--noprofile", "--norc", "-eo", "pipefail"]
    print(f"=== {wf.get('name')} / {job_name}  event={a.event} ref={ref_name} sha={sha[:8]}")

    def run_steps(steps, extra_ctx=None, label=""):
        for idx, step in enumerate(steps):
            name = step.get("name") or step.get("uses") or f"step {idx}"
            cond = step.get("if", "success()")
            cond = cond[3:-2] if isinstance(cond, str) and cond.startswith("${{") else cond
            saved = dict(ctx.data)
            if extra_ctx:
                ctx.data.update(extra_ctx)
            try:
                go = bool(ctx.evaluate(str(cond)))
                if not go:
                    print(f"--- skip   {label}{name}")
                    if step.get("id"):
                        ctx.steps[step["id"]] = {"outcome": "skipped"}
                    continue
                print(f"--- run    {label}{name}", flush=True)
                uses = step.get("uses", "")
                ok = True
                if uses.startswith("actions/checkout"):
                    ref = ctx.expand(str((step.get("with") or {}).get("ref", sha)))
                    shutil.rmtree(ws, ignore_errors=True)
                    subprocess.check_call(["git", "clone", "-q", "--no-local", REPO, ws])
                    subprocess.check_call(["git", "-C", ws, "checkout", "-q", subprocess.check_output(["git", "-C", REPO, "rev-parse", ref], text=True).strip()])
                elif uses.startswith("./"):
                    action = yaml.safe_load(open(os.path.join(ws, uses[2:], "action.yml")))
                    with_ = {k: ctx.expand(str(v)) for k, v in (step.get("with") or {}).items()}
                    ins = {k: with_.get(k, str((spec or {}).get("default", ""))) for k, spec in action["inputs"].items()}
                    run_steps(action["runs"]["steps"], {"inputs": ins}, label="  ↳ ")
                elif "run" in step:
                    env = dict(os.environ)
                    env.update({"HOME": home, "GITHUB_ENV": files["env"], "GITHUB_OUTPUT": files["output"],
                                "GITHUB_STEP_SUMMARY": files["summary"], "GITHUB_WORKSPACE": ws,
                                "GITHUB_REF_NAME": ref_name, "GITHUB_SHA": sha, "GITHUB_EVENT_NAME": a.event,
                                "CI": "true", "GITHUB_ACTIONS": "true"})
                    env.update({k: ctx.expand(str(v)) for k, v in wf_env.items()})
                    env.update(read_kv(files["env"]))
                    env.update({k: ctx.expand(str(v)) for k, v in (step.get("env") or {}).items()})
                    script = ctx.expand(step["run"])
                    sf = os.path.join(run_dir, f"step-{idx}.sh")
                    open(sf, "w").write(script)
                    open(files["output"], "w").close()
                    r = subprocess.run(shell + [sf], cwd=ws if os.path.isdir(ws) else run_dir, env=env)
                    ok = r.returncode == 0
                    if step.get("id"):
                        ctx.steps[step["id"]] = {"outcome": "success" if ok else "failure", "outputs": read_kv(files["output"])}
                if not ok:
                    print(f"!!! FAILED {label}{name}")
                    if not step.get("continue-on-error"):
                        ctx.job_status = "failure"
                    if step.get("id"):
                        ctx.steps[step["id"]]["outcome"] = "failure"
                elif step.get("id") and step["id"] not in ctx.steps:
                    ctx.steps[step["id"]] = {"outcome": "success"}
            except subprocess.CalledProcessError as err:
                print(f"!!! FAILED {label}{name}: {err}")
                ctx.job_status = "failure"
            finally:
                if extra_ctx:
                    for k in extra_ctx:
                        if k in saved:
                            ctx.data[k] = saved[k]
                        else:
                            ctx.data.pop(k, None)

    run_steps(job["steps"])
    print("=== job", ctx.job_status.upper())
    summary = open(files["summary"]).read().strip()
    if summary:
        print("--- step summary ---\n" + summary)
    sys.exit(0 if ctx.job_status == "success" else 1)


if __name__ == "__main__":
    main()
