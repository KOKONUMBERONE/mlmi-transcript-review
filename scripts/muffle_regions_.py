#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

SR = 44100  # everything is processed as mono at this rate


# ────────────────────────────────────────────────────────────── time parsing ──

def parse_time(text: str) -> float:
    """'88.9' | '1:28.9' | '1:02:03.5'  ->  seconds."""
    parts = text.strip().split(":")
    if not parts or any(p == "" for p in parts):
        raise ValueError(f"bad time {text!r}")
    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + float(part)
    return seconds


def parse_region(text: str) -> tuple[float, float, float | None, float | None]:
    """'START-END [lowpass] [attenuate]' from --region, or a regions-file line."""
    fields = text.replace(",", " ").split()
    if not fields:
        raise ValueError(f"empty region: {text!r}")
    if "-" in fields[0][1:]:
        # "12.4-13.1" / "1:12.4-1:13.1", optionally followed by the overrides
        start_text, _, end_text = fields[0].partition("-")
        rest = fields[1:]
        if not end_text:
            raise ValueError(f"region needs START-END: {text!r}")
    else:
        # whitespace-separated "START END [...]"
        if len(fields) < 2:
            raise ValueError(f"region needs START and END: {text!r}")
        start_text, end_text, *rest = fields

    start, end = parse_time(start_text), parse_time(end_text)
    if end <= start:
        raise ValueError(f"region ends before it starts: {text!r}")
    lowpass = float(rest[0]) if len(rest) > 0 else None
    attenuate = float(rest[1]) if len(rest) > 1 else None
    if lowpass is not None and lowpass < 0 and attenuate is None:
        # a cutoff can never be negative, so a lone negative number is dB —
        # this lets you override only the attenuation without naming a cutoff
        lowpass, attenuate = None, lowpass
    return start, end, lowpass, attenuate


def read_regions_file(path: str) -> list[tuple[float, float, float | None, float | None]]:
    regions = []
    with open(path, encoding="utf-8") as handle:
        for number, raw in enumerate(handle, 1):
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            try:
                regions.append(parse_region(line))
            except ValueError as exc:
                raise SystemExit(f"{path}:{number}: {exc}")
    return regions


# ───────────────────────────────────────────────────────────────── audio i/o ──

def decode(path: str) -> np.ndarray:
    """Decode anything ffmpeg reads into mono float32 at SR."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
        tmp = handle.name
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), tmp],
            check=True,
        )
        audio, _ = sf.read(tmp, dtype="float32")
    finally:
        os.unlink(tmp)
    return audio


def encode(audio: np.ndarray, out_path: str, noise: float, color: str, bitrate: str) -> None:
    """Write mp3, mixing in the noise bed on the way out if one was asked for."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
        tmp = handle.name
    try:
        sf.write(tmp, audio, SR)
        command = ["ffmpeg", "-y", "-v", "error", "-i", tmp]
        if noise > 0:
            command += [
                "-filter_complex",
                f"[0:a]anull[voice];"
                f"anoisesrc=color={color}:amplitude={noise}:seed=7[bed];"
                f"[voice][bed]amix=inputs=2:duration=first:normalize=0[out]",
                "-map", "[out]",
            ]
        command += ["-c:a", "libmp3lame", "-b:a", bitrate, out_path]
        subprocess.run(command, check=True)
    finally:
        os.unlink(tmp)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if len(x) else 0.0


def db(ratio: float) -> float:
    return 20 * np.log10(ratio) if ratio > 1e-12 else float("-inf")


# ──────────────────────────────────────────────────────────────── processing ──

def merge_overlaps(regions: list, pad_s: float, duration: float) -> list:
    """Widen by --pad, clamp to the file, and fuse any regions that now touch.

    Per-region settings are already resolved against the global defaults by this
    point, so fusing can simply keep the stronger of the two treatments.
    """
    widened = []
    for start, end, lowpass, attenuate in regions:
        widened.append(
            (max(0.0, start - pad_s), min(duration, end + pad_s), lowpass, attenuate)
        )
    widened.sort(key=lambda r: r[0])

    merged: list = []
    for region in widened:
        if merged and region[0] <= merged[-1][1]:
            previous = merged[-1]
            merged[-1] = (
                previous[0],
                max(previous[1], region[1]),
                min(previous[2], region[2]),   # lower cutoff  = more muffled
                min(previous[3], region[3]),   # lower dB      = more attenuated
            )
        else:
            merged.append(region)
    return merged


def muffle(
    audio: np.ndarray,
    regions: list,
    order: int,
    crossfade_ms: float,
    match_level: bool,
) -> list[dict]:
    """Apply the treatment in place. Returns one report row per region."""
    fade = int(crossfade_ms / 1000 * SR)
    ramp_up = np.linspace(0, 1, fade, dtype="float32")
    ramp_down = ramp_up[::-1].copy()

    filters: dict[tuple[float, int], np.ndarray] = {}
    report = []

    for start, end, lowpass, attenuate in regions:
        cutoff, drop_db = lowpass, attenuate

        i0, i1 = int(start * SR), int(end * SR)
        segment = audio[i0:i1]
        if len(segment) <= 2 * fade:
            report.append(
                {"start": start, "end": end, "skipped": f"shorter than 2x{crossfade_ms}ms crossfade"}
            )
            continue

        key = (cutoff, order)
        if key not in filters:
            filters[key] = butter(order, cutoff, "low", fs=SR, output="sos")

        before = rms(segment)
        treated = sosfiltfilt(filters[key], segment).astype("float32")

        if match_level:
            filtered_rms = rms(treated)
            if filtered_rms > 1e-9:
                treated *= before / filtered_rms

        treated *= 10 ** (drop_db / 20)

        # crossfade the edges, inside the region, against the untouched audio
        treated[:fade] = segment[:fade] * ramp_down + treated[:fade] * ramp_up
        treated[-fade:] = segment[-fade:] * ramp_up + treated[-fade:] * ramp_down

        audio[i0:i1] = treated
        report.append(
            {
                "start": start,
                "end": end,
                "cutoff": cutoff,
                "drop_db": drop_db,
                "measured_db": db(rms(treated) / before) if before > 1e-9 else float("nan"),
                "skipped": None,
            }
        )
    return report


# ────────────────────────────────────────────────────────────────────── main ──

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("input", help="source audio (mp3, wav, anything ffmpeg reads)")
    parser.add_argument("--region", action="append", default=[], metavar="START-END",
                        help="a stretch to muffle; repeatable")
    parser.add_argument("--regions", metavar="FILE",
                        help="file of stretches, one per line")
    parser.add_argument("--lowpass", type=float, default=750, metavar="HZ",
                        help="cutoff, lower is more muffled (default 750)")
    parser.add_argument("--attenuate", type=float, default=-7.0, metavar="DB",
                        help="deliberate level drop (default -7)")
    parser.add_argument("--order", type=int, default=4,
                        help="Butterworth order (default 4)")
    parser.add_argument("--crossfade", type=float, default=12.0, metavar="MS",
                        help="edge crossfade (default 12)")
    parser.add_argument("--pad", type=float, default=0.0, metavar="MS",
                        help="widen every stretch symmetrically (default 0)")
    parser.add_argument("--noise", type=float, default=0.02, metavar="AMPLITUDE",
                        help="noise bed level, 0 disables it (default 0.02)")
    parser.add_argument("--noise-color", default="pink",
                        choices=["pink", "white", "brown", "blue", "violet"])
    parser.add_argument("--keep-level", action="store_true",
                        help="skip the amplitude match (see the header)")
    parser.add_argument("--bitrate", default="48k", help="mp3 bitrate (default 48k)")
    parser.add_argument("--out", help="output path (default: alongside the input)")
    parser.add_argument("--suffix", default="_muffled",
                        help="suffix when --out is not given (default _muffled)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the plan and stop")
    args = parser.parse_args()

    regions = [parse_region(r) for r in args.region]
    if args.regions:
        regions += read_regions_file(args.regions)
    if not regions:
        parser.error("no regions given — use --region and/or --regions")

    # resolve each per-region override against the global defaults up front, so
    # everything downstream (merging, reporting) works on concrete numbers
    regions = [
        (start, end,
         args.lowpass if lowpass is None else lowpass,
         args.attenuate if attenuate is None else attenuate)
        for start, end, lowpass, attenuate in regions
    ]

    audio = decode(args.input)
    duration = len(audio) / SR
    regions = merge_overlaps(regions, args.pad / 1000, duration)

    print(f"{os.path.basename(args.input)}  {duration:.2f}s")
    print(f"{len(regions)} region(s) after padding/merging · lowpass {args.lowpass:g} Hz · "
          f"attenuate {args.attenuate:g} dB · crossfade {args.crossfade:g} ms · "
          f"amplitude match {'off' if args.keep_level else 'on'} · "
          f"noise {args.noise:g} ({args.noise_color})")

    if args.dry_run:
        for start, end, lowpass, attenuate in regions:
            print(f"  {start:9.3f} → {end:9.3f}  ({end - start:5.3f}s)"
                  f"  lowpass {lowpass:g} Hz, attenuate {attenuate:g} dB")
        total = sum(end - start for start, end, _, _ in regions)
        print(f"  total treated: {total:.2f}s ({total / duration * 100:.1f}% of the file)")
        return

    report = muffle(audio, regions, args.order, args.crossfade, not args.keep_level)

    out_path = args.out or os.path.join(
        os.path.dirname(os.path.abspath(args.input)),
        os.path.splitext(os.path.basename(args.input))[0] + args.suffix + ".mp3",
    )
    encode(audio, out_path, args.noise, args.noise_color, args.bitrate)

    print(f"{'start':>10}{'end':>10}{'len':>8}{'cutoff':>9}{'asked':>8}{'measured':>10}")
    for row in report:
        if row["skipped"]:
            print(f"{row['start']:>10.3f}{row['end']:>10.3f}   skipped — {row['skipped']}")
            continue
        print(f"{row['start']:>10.3f}{row['end']:>10.3f}"
              f"{row['end'] - row['start']:>8.3f}{row['cutoff']:>9.0f}"
              f"{row['drop_db']:>8.1f}{row['measured_db']:>10.1f}")
    treated = sum(r["end"] - r["start"] for r in report if not r["skipped"])
    print(f"\ntreated {treated:.2f}s of {duration:.2f}s "
          f"({treated / duration * 100:.1f}%) → {out_path}")


if __name__ == "__main__":
    main()
