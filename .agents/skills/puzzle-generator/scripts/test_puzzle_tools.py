"""Offline behavioral checks for puzzle validation, private export and review rendering."""

from __future__ import annotations

import copy
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, urlparse


SCRIPTS = Path(__file__).resolve().parent
REPO = SCRIPTS.parents[3]
PUZZLE = {
    "title": "空柜子（虚构测试）",
    "surface": "小林打开柜子，取走了一把钥匙，柜子为什么空了？",
    "bottom": "柜子里只放着一把钥匙。小林拿走了这把钥匙。",
    "difficulty": "简单",
    "is_active": False,
    "key_points": [{"id": 1, "text": "柜内唯一物品被取走", "accept": ["SOI"]}],
    "facts": [
        {"id": "F1", "text": "柜子里只放着一把钥匙", "kind": "explicit",
         "quote": "柜子里只放着一把钥匙", "status": "draft"},
        {"id": "F2", "text": "小林拿走了这把钥匙", "kind": "explicit",
         "quote": "小林拿走了这把钥匙", "status": "draft"},
        {"id": "F3", "text": "小林取走钥匙后当刻柜内为空", "kind": "derived",
         "depends_on": ["F1", "F2"], "note": "唯一物品取走，柜内当刻无剩余物品", "status": "draft"},
    ],
    "examples": [
        {"model": "fact", "boundary_type": "explicit_fact", "question": "取走的是钥匙吗？",
         "answer": "是", "reason": "原文明说小林取走钥匙", "evidence_ids": ["F2"]},
        {"model": "inferential", "boundary_type": "causal_inference", "question": "柜子空了是因为他取走了里面的全部东西吗？",
         "answer": "是", "reason": "唯一的物品被取走，所以当刻柜内为空", "evidence_ids": ["F3"]},
    ],
}


class PuzzleToolsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="onlinesoup-puzzle-tools-")
        self.addCleanup(self.tmp.cleanup)
        self.source = Path(self.tmp.name) / "preview.json"

    def write(self, puzzle):
        self.source.write_text(json.dumps([puzzle], ensure_ascii=False), encoding="utf-8")

    def validate(self, puzzle, *args):
        self.write(puzzle)
        return subprocess.run([sys.executable, str(SCRIPTS / "validate_puzzles.py"), str(self.source), *args],
                              cwd=REPO, capture_output=True, text=True, timeout=30)

    def test_complete_draft_and_reviewed_production_copy(self):
        result = self.validate(PUZZLE)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.validate(PUZZLE, "--require-approved-facts")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not approved", result.stderr)
        puzzle = copy.deepcopy(PUZZLE)
        for fact in puzzle["facts"]:
            fact["status"] = "approved"
        for example in puzzle["examples"]:
            del example["evidence_ids"]
            del example["boundary_type"]
        result = self.validate(puzzle, "--require-approved-facts", "--allow-missing-evidence-ids",
                               "--allow-missing-boundary-type")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_canonical_fact_errors(self):
        cases = []
        puzzle = copy.deepcopy(PUZZLE)
        puzzle["facts"][0]["quote"] = "原文不存在的片段"
        cases.append((puzzle, "quote 在汤底和汤面中找不到"))
        puzzle = copy.deepcopy(PUZZLE)
        puzzle["facts"][0].update(kind="derived", depends_on=["F3"])
        cases.append((puzzle, "循环依赖"))
        puzzle = copy.deepcopy(PUZZLE)
        puzzle["facts"][2]["status"] = "approved"
        cases.append((puzzle, "依赖的 F1 未批准"))
        puzzle = copy.deepcopy(PUZZLE)
        puzzle["facts"][2]["depends_on"] = ["F99"]
        cases.append((puzzle, "依赖不存在的 F99"))
        puzzle = copy.deepcopy(PUZZLE)
        puzzle["facts"] = [dict(PUZZLE["facts"][0], id=f"F{i}") for i in range(1, 62)]
        cases.append((puzzle, "最多 60 条"))
        for puzzle, expected in cases:
            with self.subTest(error=expected):
                result = self.validate(puzzle)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn(expected, result.stderr)

    def test_missing_and_invalid_example_evidence(self):
        for evidence in (None, [], ["F99"], "F1"):
            puzzle = copy.deepcopy(PUZZLE)
            if evidence is None:
                del puzzle["examples"][0]["evidence_ids"]
            else:
                puzzle["examples"][0]["evidence_ids"] = evidence
            with self.subTest(evidence=evidence):
                result = self.validate(puzzle)
                self.assertEqual(result.returncode, 1, result.stderr)

    def test_legacy_partial_and_malformed_fields(self):
        puzzle = copy.deepcopy(PUZZLE)
        del puzzle["facts"]
        puzzle["key_points"] = []
        for example in puzzle["examples"]:
            del example["evidence_ids"]
        self.assertEqual(self.validate(puzzle).returncode, 1)
        result = self.validate(puzzle, "--mode", "partial")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no Facts", result.stdout)
        puzzle = copy.deepcopy(PUZZLE)
        puzzle["examples"][0].update(model={}, answer=[], boundary_type={})
        puzzle["key_points"][0]["id"] = True
        result = self.validate(puzzle)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_review_page_links_escaping_and_single_puzzle(self):
        puzzle = copy.deepcopy(PUZZLE)
        puzzle["facts"][2]["note"] = '<script>alert("x")</script>'
        self.write(puzzle)
        result = subprocess.run([sys.executable, str(SCRIPTS / "render_puzzle_review.py"), str(self.source)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        page = self.source.with_suffix(".html").read_text()
        self.assertIn('id="fact-F3"', page)
        self.assertIn('href="#fact-F3"', page)
        self.assertIn("SOI · Seen Or Implied", page)
        self.assertIn("&lt;script&gt;", page)
        self.assertNotIn("<script>", page)
        self.source.write_text(json.dumps([puzzle, dict(puzzle, title="第二题")]), encoding="utf-8")
        result = subprocess.run([sys.executable, str(SCRIPTS / "render_puzzle_review.py"), str(self.source)],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("per puzzle", result.stderr)

    def test_export_preserves_facts_and_version_without_network(self):
        requests = []
        exported = dict(PUZZLE, id=123, content_version=7)

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(parse_qs(urlparse(self.path).query))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps([exported]).encode())

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        output = Path(self.tmp.name) / "export.json"
        env = dict(os.environ, NEXT_PUBLIC_SUPABASE_URL=f"http://127.0.0.1:{server.server_port}",
                   SUPABASE_SECRET_KEY="offline-test-placeholder")
        result = subprocess.run(["node", str(SCRIPTS / "export_puzzles_from_supabase.mjs"),
                                 "--output", str(output), "--active-only", "--limit", "1"],
                                cwd=REPO, env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(output.read_text()), [exported])
        selected = {field.strip() for field in requests[0]["select"][0].split(",")}
        self.assertTrue({"id", "facts", "content_version"}.issubset(selected))
        self.assertEqual(requests[0]["is_active"], ["eq.true"])
        self.assertEqual(requests[0]["limit"], ["1"])


if __name__ == "__main__":
    unittest.main()
