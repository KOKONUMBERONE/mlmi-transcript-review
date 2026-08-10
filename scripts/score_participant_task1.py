#!/usr/bin/env python3
"""Score Participant Task 1 from the final transcript stored in event logs.

The study UI writes one ``task_result`` event per displayed segment when a task
ends. This scorer compares those final strings with the private clean reference,
not with the sequence of UI edit events. Consequently, whole-sentence rewrites,
delete-and-retype actions, punctuation changes, and extra whitespace are handled
the same way as a one-word correction.

Examples:
  python3 scripts/score_participant_task1.py study_data/latest.json
  python3 scripts/score_participant_task1.py study_data/session-export.csv \
      --output study_data/analysis/task1_scores.csv
  python3 scripts/score_participant_task1.py --self-test
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REFERENCE = ROOT / "study_data" / "task1_chapter1" / "task1-reference.json"
DEFAULT_ANSWER_KEY = ROOT / "study_data" / "task1_chapter1" / "task1-answer-key.json"
PUBLIC_STIMULI = ROOT / "public" / "stimuli"
TOKEN_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)


def tokens(text: str) -> list[str]:
    """Casefold text and discard spacing/punctuation-only differences."""
    normal = unicodedata.normalize("NFKC", text).replace("’", "'").casefold()
    return TOKEN_RE.findall(normal)


@dataclass(frozen=True)
class EditOp:
    kind: str
    ref_index: int | None = None
    hyp_index: int | None = None
    ref_token: str | None = None
    hyp_token: str | None = None
    after_ref_index: int | None = None


def align(reference: list[str], hypothesis: list[str]) -> tuple[int, list[EditOp]]:
    """Levenshtein alignment with deterministic backtracking."""
    n, m = len(reference), len(hypothesis)
    dp = [list(range(m + 1))]
    for i in range(1, n + 1):
        row = [i] + [0] * m
        previous = dp[i - 1]
        for j in range(1, m + 1):
            substitution = previous[j - 1] + (reference[i - 1] != hypothesis[j - 1])
            row[j] = min(substitution, previous[j] + 1, row[j - 1] + 1)
        dp.append(row)

    operations: list[EditOp] = []
    i, j = n, m
    while i or j:
        if i and j and reference[i - 1] == hypothesis[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            operations.append(EditOp("equal", i - 1, j - 1, reference[i - 1], hypothesis[j - 1]))
            i -= 1
            j -= 1
        elif i and j and dp[i][j] == dp[i - 1][j - 1] + 1:
            operations.append(EditOp("substitute", i - 1, j - 1, reference[i - 1], hypothesis[j - 1]))
            i -= 1
            j -= 1
        elif i and dp[i][j] == dp[i - 1][j] + 1:
            operations.append(EditOp("delete", i - 1, None, reference[i - 1], None))
            i -= 1
        else:
            operations.append(EditOp("insert", None, j - 1, None, hypothesis[j - 1], i - 1))
            j -= 1
    operations.reverse()
    return dp[n][m], operations


def error_keys(operations: Iterable[EditOp]) -> set[tuple[Any, ...]]:
    keys: set[tuple[Any, ...]] = set()
    for operation in operations:
        if operation.kind in {"substitute", "delete"}:
            keys.add(("reference", operation.ref_index))
        elif operation.kind == "insert":
            keys.add(("insertion", operation.after_ref_index, operation.hyp_token))
    return keys


def reference_tokens(clip: dict[str, Any]) -> tuple[list[str], dict[int, list[int]]]:
    output: list[str] = []
    spans: dict[int, list[int]] = {}
    for word in clip["words"]:
        start = len(output)
        output.extend(tokens(str(word["text"])))
        spans[int(word["index"])] = list(range(start, len(output)))
    return output, spans


def transcript_text(path: Path) -> str:
    transcript = json.loads(path.read_text(encoding="utf-8"))
    model = next(iter(transcript["segments"][0]["words"]))
    return " ".join(
        word["text"]
        for segment in transcript["segments"]
        for word in segment["words"][model]
    )


def load_jsonish(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        return []
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return value


def load_snapshots(path: Path) -> list[dict[str, Any]]:
    """Accept a tabular study export or a browser event-log JSON file."""
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        if not rows:
            return []
        if "events" in rows[0]:
            for row in rows:
                row["events"] = load_jsonish(row.get("events"))
            return rows
        # Flat event-log CSV: group rows if a session id exists, otherwise treat
        # the file as one session. Numeric fields are needed only for sorting.
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            grouped[row.get("session_id") or path.stem].append(row)
        return [
            {
                "session_id": session_id,
                "participant_id": events[0].get("participant_id", ""),
                "events": events,
            }
            for session_id, events in grouped.items()
        ]

    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        snapshots = payload
    elif isinstance(payload, dict) and isinstance(payload.get("events"), (list, str)):
        snapshots = [payload]
    elif isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        snapshots = payload["rows"]
    elif isinstance(payload, dict) and isinstance(payload.get("data"), list):
        snapshots = payload["data"]
    else:
        raise ValueError("Expected an event-log object or a list of study rows")
    for snapshot in snapshots:
        snapshot["events"] = load_jsonish(snapshot.get("events"))
    return snapshots


def newest_snapshots(snapshots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest: dict[str, tuple[tuple[str, int, int], dict[str, Any]]] = {}
    for order, snapshot in enumerate(snapshots):
        session_id = str(snapshot.get("session_id") or f"row-{order}")
        try:
            n_events = int(snapshot.get("n_events") or len(snapshot.get("events") or []))
        except (TypeError, ValueError):
            n_events = len(snapshot.get("events") or [])
        # ISO timestamps sort lexicographically. n_events/order are safe
        # fallbacks for local exports without created_at.
        rank = (str(snapshot.get("created_at") or ""), n_events, order)
        if session_id not in latest or rank > latest[session_id][0]:
            latest[session_id] = (rank, snapshot)
    return [item[1] for item in latest.values()]


def final_trials(snapshot: dict[str, Any], known_clips: set[str]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for event in snapshot.get("events") or []:
        if event.get("type") != "task_result":
            continue
        stimulus = str(event.get("stimulus_id") or "")
        if stimulus not in known_clips:
            continue
        key = (
            stimulus,
            str(event.get("condition") or ""),
            str(event.get("trial_index") or ""),
        )
        groups[key].append(event)

    trials = []
    for (stimulus, condition, trial_index), events in groups.items():
        def sort_key(event: dict[str, Any]) -> tuple[float, int, float]:
            try:
                start = float(event.get("segment_start") or 0)
            except (TypeError, ValueError):
                start = 0
            try:
                segment_id = int(float(event.get("segment_id") or 0))
            except (TypeError, ValueError):
                segment_id = 0
            try:
                event_time = float(event.get("t_ms") or 0)
            except (TypeError, ValueError):
                event_time = 0
            return start, segment_id, event_time

        ordered = sorted(events, key=sort_key)
        trials.append(
            {
                "stimulus_id": stimulus,
                "condition": condition,
                "trial_index": trial_index,
                "final_text": " ".join(str(event.get("to_text") or "") for event in ordered),
                "result_segments": len(ordered),
            }
        )
    return trials


def score_trial(
    trial: dict[str, Any],
    reference: dict[str, Any],
    answer_key: dict[str, Any],
    initial_text: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    ref, spans = reference_tokens(reference)
    initial = tokens(initial_text)
    final = tokens(trial["final_text"])
    initial_distance, initial_ops = align(ref, initial)
    final_distance, final_ops = align(ref, final)
    ref_to_final = {
        operation.ref_index: operation.hyp_index
        for operation in final_ops
        if operation.kind == "equal"
        and operation.ref_index is not None
        and operation.hyp_index is not None
    }
    final_equal = set(ref_to_final)

    details = []
    for error in answer_key["errors"]:
        if error["errorType"] == "hallucination":
            word_index = int(error["afterReferenceIndex"])
            boundary = max(spans.get(word_index, [-1]))
            shown = tokens(str(error["shown"]))
            # Adjacent planted substitutions/omissions can make a global
            # Levenshtein path label the extra word as a substitution rather
            # than an insertion. Use the nearest unchanged reference anchors
            # on both sides and inspect the actual final tokens between them.
            # This still works after a whole-sentence rewrite.
            left_refs = [index for index in ref_to_final if index <= boundary]
            right_refs = [index for index in ref_to_final if index > boundary]
            left = ref_to_final[max(left_refs)] if left_refs else -1
            right = ref_to_final[min(right_refs)] if right_refs else len(final)
            nearby = final[left + 1 : right]
            fixed = not shown or not any(
                nearby[index : index + len(shown)] == shown
                for index in range(max(0, len(nearby) - len(shown) + 1))
            )
        else:
            word_index = int(error["referenceIndex"])
            word_span = spans.get(word_index, [])
            fixed = bool(word_span) and all(index in final_equal for index in word_span)
        details.append(
            {
                "stimulus_id": trial["stimulus_id"],
                "condition": trial["condition"],
                "trial_index": trial["trial_index"],
                "clip_time": error["clipTime"],
                "error_type": error["errorType"],
                "severity": error["severity"],
                "shown": error["shown"],
                "correct": error["correct"],
                "fixed": fixed,
            }
        )

    fixed_count = sum(bool(detail["fixed"]) for detail in details)
    planted_total = len(details)
    new_errors = len(error_keys(final_ops) - error_keys(initial_ops))
    high_details = [detail for detail in details if detail["severity"] == "high"]
    ordinary_details = [detail for detail in details if detail["severity"] == "ordinary"]
    summary = {
        "stimulus_id": trial["stimulus_id"],
        "condition": trial["condition"],
        "trial_index": trial["trial_index"],
        "result_segments": trial["result_segments"],
        "reference_words": len(ref),
        "planted_errors": planted_total,
        "corrected_errors": fixed_count,
        "missed_errors": planted_total - fixed_count,
        "correction_recall": round(fixed_count / planted_total, 4) if planted_total else 0,
        "high_errors_corrected": sum(bool(detail["fixed"]) for detail in high_details),
        "high_errors_total": len(high_details),
        "ordinary_errors_corrected": sum(bool(detail["fixed"]) for detail in ordinary_details),
        "ordinary_errors_total": len(ordinary_details),
        "new_word_errors": new_errors,
        "correction_precision": round(fixed_count / (fixed_count + new_errors), 4)
        if fixed_count + new_errors
        else 0,
        "initial_word_errors": initial_distance,
        "final_word_errors": final_distance,
        "word_error_reduction": initial_distance - final_distance,
        "initial_wer": round(initial_distance / len(ref), 4) if ref else 0,
        "final_wer": round(final_distance / len(ref), 4) if ref else 0,
    }
    return summary, details


def write_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".json":
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def load_private(path: Path, label: str) -> dict[str, dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"{label} not found: {path}\nRun scripts/build_participant_task1.py first.")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {str(clip["clip"]): clip for clip in payload["clips"]}


def run_self_test(
    references: dict[str, dict[str, Any]], answer_keys: dict[str, dict[str, Any]]
) -> None:
    for clip_id, reference in references.items():
        initial = transcript_text(PUBLIC_STIMULI / f"{clip_id}.json")
        cases = {
            "unchanged": initial,
            "perfect_with_extra_spacing": "  \n".join(word["text"] for word in reference["words"]),
        }
        results = {}
        for label, final_text in cases.items():
            summary, _ = score_trial(
                {
                    "stimulus_id": clip_id,
                    "condition": "TEST",
                    "trial_index": "0",
                    "final_text": final_text,
                    "result_segments": 1,
                },
                reference,
                answer_keys[clip_id],
                initial,
            )
            results[label] = summary
        assert results["unchanged"]["corrected_errors"] == 0, results["unchanged"]
        assert results["perfect_with_extra_spacing"]["corrected_errors"] == results["perfect_with_extra_spacing"]["planted_errors"]
        assert results["perfect_with_extra_spacing"]["final_word_errors"] == 0
        print(f"{clip_id}: unchanged=0 fixed; perfect={results['perfect_with_extra_spacing']['planted_errors']} fixed; spacing ignored")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, help="Study export or event-log JSON/CSV")
    parser.add_argument("--reference", type=Path, default=DEFAULT_REFERENCE)
    parser.add_argument("--answer-key", type=Path, default=DEFAULT_ANSWER_KEY)
    parser.add_argument("--output", type=Path, help="Write summary CSV or JSON (details are written beside it)")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    references = load_private(args.reference, "Task 1 reference")
    answer_keys = load_private(args.answer_key, "Task 1 answer key")
    if args.self_test:
        run_self_test(references, answer_keys)
        if args.input is None:
            return
    if args.input is None:
        parser.error("input is required unless --self-test is used")

    snapshots = newest_snapshots(load_snapshots(args.input))
    summaries: list[dict[str, Any]] = []
    details: list[dict[str, Any]] = []
    for snapshot in snapshots:
        session_id = str(snapshot.get("session_id") or args.input.stem)
        participant_id = str(snapshot.get("participant_id") or "")
        for trial in final_trials(snapshot, set(references)):
            clip_id = trial["stimulus_id"]
            summary, trial_details = score_trial(
                trial,
                references[clip_id],
                answer_keys[clip_id],
                transcript_text(PUBLIC_STIMULI / f"{clip_id}.json"),
            )
            summary = {"session_id": session_id, "participant_id": participant_id, **summary}
            summaries.append(summary)
            details.extend(
                {"session_id": session_id, "participant_id": participant_id, **detail}
                for detail in trial_details
            )

    if not summaries:
        raise SystemExit(
            "No Task 1 task_result events found. New sessions record them automatically; "
            "older event logs contain edit history only and cannot be scored reliably."
        )
    if args.output:
        write_rows(args.output, summaries)
        details_path = args.output.with_name(f"{args.output.stem}-details{args.output.suffix}")
        write_rows(details_path, details)
        print(f"Wrote {args.output}")
        print(f"Wrote {details_path}")
    else:
        json.dump({"scores": summaries, "details": details}, sys.stdout, ensure_ascii=False, indent=2)
        print()


if __name__ == "__main__":
    main()
