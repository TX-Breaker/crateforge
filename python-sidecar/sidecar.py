#!/usr/bin/env python3
"""CrateForge sidecar (Fase 1: pyrekordbox + fpcalc).

Contratto con il processo Node (vedi src/main/sidecar.ts):
  - invocazione:  sidecar <comando> --udm-path <file> [opzioni]
  - stdout:       SOLO righe JSON {type: progress|done|error|log, ...}
  - dati di massa: scritti DIRETTAMENTE nell'UDM (writer-ownership §2),
    mai attraverso stdout.
  - lo schema UDM è di proprietà di Node: qui niente DDL, solo INSERT/UPDATE
    nelle tabelle di ingestion (tracks, playlists, playlist_tracks, cues,
    ingest_runs).
  - il master.db cifrato è competenza esclusiva di questo processo, aperto in
    sola lettura via pyrekordbox/sqlcipher3. Node non lo tocca mai.

Comandi:
  ping                verifica presenza/avviabilità (usato dai test di fumo)
  ingest-masterdb     legge master.db e popola l'UDM
  fingerprint         calcola l'impronta Chromaprint di un singolo file (fpcalc)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Emissione eventi (throttling obbligatorio §2: mai un evento per traccia)
# ---------------------------------------------------------------------------

_MIN_INTERVAL_S = 0.15


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class ThrottledProgress:
    """Coalizza i progressi: max ~1 evento ogni 150 ms o ogni 100 item."""

    def __init__(self, phase: str) -> None:
        self.phase = phase
        self._last_emit = 0.0
        self._last_done = 0

    def update(self, done: int, total: int) -> None:
        now = time.monotonic()
        if done - self._last_done < 100 and now - self._last_emit < _MIN_INTERVAL_S:
            return
        self._last_emit = now
        self._last_done = done
        emit({"type": "progress", "phase": self.phase, "done": done, "total": total})

    def finish(self, done: int, total: int) -> None:
        emit({"type": "progress", "phase": self.phase, "done": done, "total": total})


def fail(message: str, code: int = 1) -> "NoReturn":  # noqa: F821
    emit({"type": "error", "message": message})
    sys.exit(code)


# ---------------------------------------------------------------------------
# Normalizzazioni (specchiano src/core/camelot.ts e versionRegex.ts)
# ---------------------------------------------------------------------------

_CAMELOT_MAJOR = {
    "B": "1B", "F#": "2B", "GB": "2B", "DB": "3B", "C#": "3B", "AB": "4B",
    "G#": "4B", "EB": "5B", "D#": "5B", "BB": "6B", "A#": "6B", "F": "7B",
    "C": "8B", "G": "9B", "D": "10B", "A": "11B", "E": "12B",
}
_CAMELOT_MINOR = {
    "G#": "1A", "AB": "1A", "D#": "2A", "EB": "2A", "A#": "3A", "BB": "3A",
    "F": "4A", "C": "5A", "G": "6A", "D": "7A", "A": "8A", "E": "9A",
    "B": "10A", "F#": "11A", "GB": "11A", "C#": "12A", "DB": "12A",
}


def to_camelot(key: str | None) -> str | None:
    if not key:
        return None
    raw = key.strip()
    m = re.match(r"^([1-9]|1[0-2])\s*([ABab])$", raw)
    if m:
        return f"{int(m.group(1))}{m.group(2).upper()}"
    m = re.match(r"^([A-Ga-g])\s*([#♯b♭]?)\s*(.*)$", raw)
    if not m:
        return None
    acc = {"♯": "#", "♭": "B", "b": "B"}.get(m.group(2), m.group(2))
    note = (m.group(1).upper() + acc).upper()
    mode = m.group(3).strip().lower()
    is_minor = mode == "m" or mode.startswith("min") or mode == "-"
    is_major = mode == "" or mode.startswith("maj") or mode == "dur"
    if is_minor:
        return _CAMELOT_MINOR.get(note)
    if is_major:
        return _CAMELOT_MAJOR.get(note)
    return None


_VERSION_KEYWORDS = (
    r"extended mix|extended version|extended edit|extended|radio edit|radio mix|"
    r"club mix|club edit|original mix|vocal mix|dub mix|instrumental|acapella|"
    r"a cappella|remaster(?:ed)?(?:\s+\d{4})?|bootleg|mashup|mash-up|rework|"
    r"remix|flip|vip(?:\s+mix)?|edit|refix|intro(?:\s+clean)?|clean|dirty"
)
_BRACKETED = re.compile(
    r"[(\[]([^()\[\]]*?\b(?:%s)\b[^()\[\]]*?)[)\]]" % _VERSION_KEYWORDS, re.I
)
_TRAILING = re.compile(
    r"[-–—]\s*([^-–—]*?\b(?:%s)\b[^-–—]*?)\s*$" % _VERSION_KEYWORDS, re.I
)


def extract_version_label(title_or_filename: str | None) -> str | None:
    if not title_or_filename:
        return None
    base = re.sub(r"\.[a-z0-9]{2,5}$", "", title_or_filename, flags=re.I)
    m = _BRACKETED.search(base) or _TRAILING.search(base)
    if not m:
        return None
    label = re.sub(r"\s+", " ", m.group(1)).strip()
    return re.sub(r"\b\w", lambda c: c.group(0).upper(), label)


# ---------------------------------------------------------------------------
# UDM (SQLite in chiaro): apertura del file GIÀ creato/migrato da Node
# ---------------------------------------------------------------------------

def open_udm(udm_path: str) -> sqlite3.Connection:
    if not os.path.exists(udm_path):
        fail(
            f"UDM non trovato al percorso ricevuto: {udm_path}. "
            "Il file deve essere creato da Node prima dello spawn del sidecar."
        )
    conn = sqlite3.connect(udm_path, timeout=10)
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    # Verifica handshake: lo schema deve esistere (Node è l'owner, qui no DDL).
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tracks'"
    ).fetchone()
    if row is None:
        fail("Schema UDM assente: Node non ha eseguito le migrazioni.")
    return conn


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# ingest-masterdb
# ---------------------------------------------------------------------------

def cmd_ingest_masterdb(args: argparse.Namespace) -> None:
    try:
        from pyrekordbox import Rekordbox6Database  # import pigro: ~lento
    except ImportError as exc:
        fail(f"pyrekordbox non installato nel sidecar: {exc}")

    udm = open_udm(args.udm_path)

    try:
        if args.key:
            rb = Rekordbox6Database(path=args.master_db, key=args.key)
        else:
            rb = Rekordbox6Database(path=args.master_db)
    except Exception as exc:  # chiave non estraibile, file corrotto, versione nuova…
        fail(
            "Impossibile aprire master.db (chiave non disponibile o versione non "
            f"supportata): {exc}. Usa la modalità solo-XML."
        )

    run_id = udm.execute(
        "INSERT INTO ingest_runs (source, started_at, status) VALUES ('masterdb', ?, 'running')",
        (_utcnow(),),
    ).lastrowid
    udm.commit()

    progress = ThrottledProgress("ingest-masterdb")
    inserted = 0
    try:
        contents = list(rb.get_content())
        total = len(contents)
        emit({"type": "log", "message": f"master.db aperto: {total} contenuti"})

        # Transazioni brevi (§2): commit a blocchi di 500.
        for i, c in enumerate(contents):
            row = _content_to_track(c)
            if row is None:
                continue
            udm.execute(
                """
                INSERT INTO tracks (source, source_id, title, artist, album, genre,
                                    year, bpm, musical_key, camelot, duration_s, path,
                                    filesize, version_label, has_tag_issues,
                                    needs_review, review_reason)
                VALUES ('masterdb', :source_id, :title, :artist, :album, :genre,
                        :year, :bpm, :musical_key, :camelot, :duration_s, :path,
                        :filesize, :version_label, :has_tag_issues,
                        :needs_review, :review_reason)
                ON CONFLICT(source, source_id) DO UPDATE SET
                    title=excluded.title, artist=excluded.artist,
                    album=excluded.album, genre=excluded.genre,
                    year=excluded.year, bpm=excluded.bpm,
                    musical_key=excluded.musical_key, camelot=excluded.camelot,
                    duration_s=excluded.duration_s, path=excluded.path,
                    filesize=excluded.filesize,
                    version_label=excluded.version_label,
                    has_tag_issues=excluded.has_tag_issues,
                    needs_review=excluded.needs_review,
                    review_reason=excluded.review_reason
                """,
                row,
            )
            inserted += 1
            if inserted % 500 == 0:
                udm.commit()
            progress.update(i + 1, total)
        udm.commit()

        _ingest_playlists(rb, udm)
        udm.commit()

        udm.execute(
            "UPDATE ingest_runs SET finished_at=?, status='ok', track_count=? WHERE id=?",
            (_utcnow(), inserted, run_id),
        )
        udm.commit()
        progress.finish(total, total)
        emit({"type": "done", "data": {"tracks": inserted}})
    except Exception as exc:
        udm.rollback()
        udm.execute(
            "UPDATE ingest_runs SET finished_at=?, status='error', error=? WHERE id=?",
            (_utcnow(), str(exc), run_id),
        )
        udm.commit()
        fail(f"Errore durante l'ingestion: {exc}")
    finally:
        udm.close()


def _get(obj, *names):
    """Primo attributo non-None tra quelli indicati (schema pyrekordbox variabile)."""
    for n in names:
        try:
            v = getattr(obj, n)
        except Exception:
            continue
        if v is not None:
            return v
    return None


def _content_to_track(c) -> dict | None:
    source_id = _get(c, "ID", "id")
    if source_id is None:
        return None
    title = _get(c, "Title")
    artist = _get(_get(c, "Artist"), "Name") or _get(c, "ArtistName")
    album = _get(_get(c, "Album"), "Name") or _get(c, "AlbumName")
    genre = _get(_get(c, "Genre"), "Name") or _get(c, "GenreName")
    key_name = _get(_get(c, "Key"), "ScaleName") or _get(c, "KeyName")
    bpm_raw = _get(c, "BPM")
    bpm = (bpm_raw / 100.0) if isinstance(bpm_raw, (int, float)) and bpm_raw > 400 else bpm_raw
    length = _get(c, "Length")  # secondi
    path = _get(c, "FolderPath")  # pyrekordbox: percorso file completo
    year = _get(c, "ReleaseYear", "Year")
    filesize = _get(c, "FileSize")

    missing_core = not title or not artist
    version = extract_version_label(title) or extract_version_label(
        os.path.basename(path) if path else None
    )
    return {
        "source_id": str(source_id),
        "title": title,
        "artist": artist,
        "album": album,
        "genre": genre,
        "year": int(year) if year else None,
        "bpm": float(bpm) if bpm else None,
        "musical_key": key_name,
        "camelot": to_camelot(key_name),
        "duration_s": float(length) if length else None,
        "path": path,
        "filesize": int(filesize) if filesize else None,
        "version_label": version,
        "has_tag_issues": 1 if missing_core else 0,
        "needs_review": 0,
        "review_reason": None,
    }


def _ingest_playlists(rb, udm: sqlite3.Connection) -> None:
    """Playlist + membership. Best-effort: se lo schema differisce, logga e salta."""
    try:
        playlists = list(rb.get_playlist())
    except Exception as exc:
        emit({"type": "log", "message": f"Playlist non lette: {exc}"})
        return

    id_map: dict[str, int] = {}
    for p in playlists:
        pid = _get(p, "ID", "id")
        name = _get(p, "Name")
        if pid is None or name is None:
            continue
        attr = _get(p, "Attribute")
        is_folder = 1 if attr == 1 else 0  # 0=playlist, 1=folder, 4=smartlist
        cur = udm.execute(
            """
            INSERT INTO playlists (source, source_id, name, is_folder, sort_order)
            VALUES ('masterdb', ?, ?, ?, ?)
            ON CONFLICT(source, source_id) DO UPDATE SET
                name=excluded.name, is_folder=excluded.is_folder,
                sort_order=excluded.sort_order
            """,
            (str(pid), str(name), is_folder, int(_get(p, "Seq") or 0)),
        )
        row = udm.execute(
            "SELECT id FROM playlists WHERE source='masterdb' AND source_id=?",
            (str(pid),),
        ).fetchone()
        id_map[str(pid)] = row[0] if row else cur.lastrowid

    # parent linking (secondo giro: i parent potrebbero venire dopo i figli)
    for p in playlists:
        pid, parent = _get(p, "ID", "id"), _get(p, "ParentID")
        if pid is None or parent in (None, "root", "0"):
            continue
        if str(parent) in id_map:
            udm.execute(
                "UPDATE playlists SET parent_id=? WHERE source='masterdb' AND source_id=?",
                (id_map[str(parent)], str(pid)),
            )

    # membership
    for p in playlists:
        pid = _get(p, "ID", "id")
        if pid is None or str(pid) not in id_map:
            continue
        try:
            songs = list(_get(p, "Songs") or [])
        except Exception:
            continue
        udm.execute("DELETE FROM playlist_tracks WHERE playlist_id=?", (id_map[str(pid)],))
        for song in songs:
            content_id = _get(song, "ContentID")
            seq = _get(song, "TrackNo", "Seq") or 0
            if content_id is None:
                continue
            row = udm.execute(
                "SELECT id FROM tracks WHERE source='masterdb' AND source_id=?",
                (str(content_id),),
            ).fetchone()
            if row:
                udm.execute(
                    """INSERT OR REPLACE INTO playlist_tracks
                       (playlist_id, track_id, position) VALUES (?, ?, ?)""",
                    (id_map[str(pid)], row[0], int(seq)),
                )


# ---------------------------------------------------------------------------
# fingerprint (fpcalc / Chromaprint) — base per il dedup di Fase 2
# ---------------------------------------------------------------------------

def cmd_fingerprint(args: argparse.Namespace) -> None:
    udm = open_udm(args.udm_path)
    try:
        out = subprocess.run(
            ["fpcalc", "-json", args.file],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except FileNotFoundError:
        fail("fpcalc (Chromaprint) non trovato nel PATH.")
    except subprocess.TimeoutExpired:
        fail("fpcalc: timeout sul file.")
    if out.returncode != 0:
        fail(f"fpcalc exit {out.returncode}: {out.stderr.strip()[:500]}")
    data = json.loads(out.stdout)
    fp = data.get("fingerprint")
    if fp and args.track_id:
        udm.execute("UPDATE tracks SET acoustic_id=? WHERE id=?", (fp[:64], int(args.track_id)))
        udm.commit()
    udm.close()
    emit({"type": "done", "data": {"duration": data.get("duration"), "hasFingerprint": bool(fp)}})


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(prog="crateforge-sidecar")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ping = sub.add_parser("ping")
    p_ping.add_argument("--udm-path", required=False)

    p_ingest = sub.add_parser("ingest-masterdb")
    p_ingest.add_argument("--udm-path", required=True)
    p_ingest.add_argument("--master-db", required=True)
    p_ingest.add_argument("--options-json", required=False)
    p_ingest.add_argument("--key", required=False, help="chiave SQLCipher esplicita (test/Esperto)")

    p_fp = sub.add_parser("fingerprint")
    p_fp.add_argument("--udm-path", required=True)
    p_fp.add_argument("--file", required=True)
    p_fp.add_argument("--track-id", required=False)

    args = parser.parse_args()

    if args.command == "ping":
        emit({"type": "done", "data": {"pong": True, "python": sys.version.split()[0]}})
    elif args.command == "ingest-masterdb":
        cmd_ingest_masterdb(args)
    elif args.command == "fingerprint":
        cmd_fingerprint(args)


if __name__ == "__main__":
    main()
