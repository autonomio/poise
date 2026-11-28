import os
import json
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import TestCase
from unittest.mock import AsyncMock, patch

import agent_interface as api
from agent_interface import atoms, pr_approve, pr_review, review_budget
from github_interface import cli, context


class TestReviewIdentityContext(TestCase):
    def test_github_cli_passes_explicit_repository_for_every_review_command(self):
        common = ["--repository", "Vaquum/example", "--token-user", "reviewer"]
        cases = [
            ("--pr-review", "pr_review", ["--expected-head", "a" * 40]),
            ("--review-activity-since", "review_activity_since", ["--username", "reviewer", "--since", "1970-01-01T00:00:00Z"]),
            ("--request-changes", "request_changes", ["--expected-head", "a" * 40, "--comments-json", "[]"]),
            ("--approve-pr", "approve_pr", ["--expected-head", "a" * 40]),
            ("--reviewed-clean", "reviewed_clean", ["--expected-head", "a" * 40, "--assessment-json", "{}"]),
            ("--create-pr-linked-issue", "create_pr_linked_issue", ["--title", "title", "--body", "body"]),
            ("--pull-action-state", "pull_action_state", []),
        ]
        for flag, name, options in cases:
            operation = AsyncMock(return_value={})
            with self.subTest(command=flag), patch.object(cli, name, operation), \
                    patch.object(sys, "argv", ["github-interface", flag, "#17", *options, *common]), \
                    redirect_stdout(StringIO()):
                cli.main()
            self.assertEqual(operation.await_args.args[0]["repository"], "Vaquum/example")

    def test_full_pr_url_and_identity_directory_agree_without_a_git_checkout(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "poise-gh-interface" / "Vaquum" / "example"
            path.mkdir(parents=True)
            previous = Path.cwd()
            try:
                os.chdir(path)
                self.assertEqual(atoms.repo_name("https://github.com/Vaquum/example/pull/17", str(path)), "Vaquum/example")
                self.assertEqual(atoms.pr_ref("https://github.com/Vaquum/example/pull/17"), "#17")
                self.assertEqual(context.repository({}), ("Vaquum", "example"))
            finally:
                os.chdir(previous)

    def test_url_review_pins_repository_even_with_an_unrelated_parent_git_remote(self):
        with tempfile.TemporaryDirectory() as temporary:
            subprocess.run(["git", "init", "-q", temporary], check=True)
            subprocess.run(["git", "-C", temporary, "remote", "add", "origin", "https://github.com/Wrong/other.git"], check=True)
            path = Path(temporary) / "poise-gh-interface" / "Vaquum" / "example"
            path.mkdir(parents=True)
            cli = Path(temporary) / "github-interface"
            cli.write_text(f'''#!{sys.executable}
import json, sys
from github_interface.context import repository
args = sys.argv[1:]
owner, repo = repository({{"repository": args[args.index("--repository") + 1] if "--repository" in args else None}})
actor = args[args.index("--token-user") + 1]
print(json.dumps({{"action":"review_activity_since", "repository":owner + "/" + repo, "reviewer_latest_complete_commit":None,
                  "pull_number":17, "username":actor, "state":"OPEN", "draft":False, "head_sha":"a" * 40}}))
''')
            cli.chmod(0o700)
            with patch.dict(os.environ, {"GITHUB_INTERFACE_CLI": str(cli)}), review_budget.ReviewBudget():
                pr = "https://github.com/Vaquum/example/pull/17"
                result = api.review_facts(pr_review, pr, str(path), "reviewer", "a" * 40, 0)
                self.assertIsNone(atoms.last_reviewed_head(str(path), pr, "reviewer"))
                packet = json.loads(atoms.packet(str(path), pr, "reviewer", "a" * 40, manifest=False))
            self.assertEqual((result["repository"], result["username"]), ("Vaquum/example", "reviewer"))
            self.assertEqual(packet["repository"], "Vaquum/example")
            for rule in pr_review.allowed(pr, "reviewer", "a" * 40) + pr_approve.allowed(pr, "reviewer", "a" * 40):
                self.assertIn("--repository Vaquum/example", rule)
