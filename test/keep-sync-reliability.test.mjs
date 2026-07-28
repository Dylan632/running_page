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

test('Hiking sync keeps mountaineering records and skips walking records early', () => {
  const result = runPython(`
import ast

source = open("run_page/keep_sync.py", encoding="utf-8").read()
tree = ast.parse(source)
mapping = next(
    node
    for node in tree.body
    if isinstance(node, ast.Assign)
    and any(
        isinstance(target, ast.Name) and target.id == "KEEP_SYNC_DATA_TYPES"
        for target in node.targets
    )
)
strava_mapping = next(
    node
    for node in tree.body
    if isinstance(node, ast.Assign)
    and any(
        isinstance(target, ast.Name) and target.id == "KEEP2STRAVA"
        for target in node.targets
    )
)
function = next(
    node
    for node in tree.body
    if isinstance(node, ast.FunctionDef)
    and node.name == "matches_sync_data_type"
)
namespace = {}
exec(
    compile(
        ast.Module(body=[mapping, function], type_ignores=[]),
        "<keep-sync-policy>",
        "exec",
    ),
    namespace,
)
matches = namespace["matches_sync_data_type"]

assert matches({"dataType": "mountaineering"}, "hiking")
assert not matches({"dataType": "indoorWalking"}, "hiking")
assert not matches({"dataType": "outdoorWalking"}, "hiking")
assert matches({}, "hiking")
assert ast.literal_eval(strava_mapping.value)["indoorWalking"] == "Walk"
  `);

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('indoor detection normalizes subtype even without an outdoor reference route', () => {
  const result = runPython(`
import ast
from types import SimpleNamespace

source = open("run_page/generator/__init__.py", encoding="utf-8").read()
tree = ast.parse(source)
generator = next(
    node
    for node in tree.body
    if isinstance(node, ast.ClassDef) and node.name == "Generator"
)
function = next(
    node
    for node in generator.body
    if isinstance(node, ast.FunctionDef) and node.name == "_fix_indoor_locations"
)
function.decorator_list = []
namespace = {
    "polyline_codec": SimpleNamespace(
        decode=lambda _polyline: [],
        encode=lambda _route: "",
    ),
    "_build_route_for_distance": lambda _route, _distance: [],
}
exec(
    compile(
        ast.Module(body=[function], type_ignores=[]),
        "<indoor-classification>",
        "exec",
    ),
    namespace,
)

activity = {
    "run_id": 1,
    "type": "Run",
    "subtype": "Run",
    "distance": 5_000,
    "summary_polyline": "",
    "location_country": "",
}
normalized = namespace["_fix_indoor_locations"]([activity])
assert normalized[0]["subtype"] == "indoor"
  `);

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
