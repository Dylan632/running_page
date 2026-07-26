import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const runPython = (source) =>
  spawnSync('python3', ['-c', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

test('Keep requests use a timeout and stop after three transient failures', () => {
  const result = runPython(`
from run_page.keep_http import KeepRequestError, request_json

class Response:
    status_code = 503

    def raise_for_status(self):
        raise RuntimeError("service unavailable")

    def json(self):
        return {}

class Session:
    def __init__(self):
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return Response()

session = Session()
try:
    request_json(
        session,
        "GET",
        "https://keep.invalid/records",
        sleep=lambda _seconds: None,
    )
except KeepRequestError:
    pass
else:
    raise AssertionError("a permanently failing request must stop the sync")

assert len(session.calls) == 3
assert all(call[2]["timeout"] == (5.0, 30.0) for call in session.calls)
  `);

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('one malformed Keep record aborts the complete record batch', () => {
  const result = runPython(`
from run_page.keep_http import KeepRecordError, collect_keep_records

def load_record(record_id):
    return {"id": record_id}

def parse_record(payload):
    if payload["id"] == "broken":
        raise ValueError("malformed track")
    return {"run_id": payload["id"]}

try:
    collect_keep_records(["good", "broken", "unreached"], load_record, parse_record)
except KeepRecordError as error:
    assert error.record_id == "broken"
    assert "malformed track" in str(error)
else:
    raise AssertionError("a partial Keep batch must never be returned")
  `);

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
