"""Firefox-Integrationstests ausführen.

    python firefox/run_firefox.py              alle Tests, Firefox unsichtbar (headless)
    python firefox/run_firefox.py cache        nur Tests, deren Datei oder Name „cache“ enthält
    python firefox/run_firefox.py --headed     Firefox sichtbar (zum Zuschauen)
    python firefox/run_firefox.py --firefox "C:\\Program Files\\Mozilla Firefox\\firefox.exe"

Jeder Test startet ein frisches Firefox-Profil; das eigene Profil wird nicht berührt.
"""
import argparse, importlib.util, os, sys, time, traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("filter", nargs="?", default="")
    ap.add_argument("--headed", action="store_true", help="Firefox sichtbar starten")
    ap.add_argument("--firefox", help="Pfad zu firefox(.exe)")
    ap.add_argument("--geckodriver", help="Pfad zu geckodriver(.exe)")
    a = ap.parse_args()
    if a.firefox:
        os.environ["FIREFOX_BIN"] = a.firefox
    if a.geckodriver:
        os.environ["GECKODRIVER"] = a.geckodriver

    passed = failed = skipped = 0
    with common.Servers():
        for f in sorted(HERE.glob("test_*.py")):
            spec = importlib.util.spec_from_file_location(f.stem, f)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            for name, fn, opts in mod.TESTS:
                if a.filter and a.filter.lower() not in (f.stem + " " + name).lower():
                    continue
                print(f"\n{f.name} – {name}")
                h = None
                t0 = time.time()
                try:
                    h = common.Harness(headed=a.headed, **opts)
                    fn(h)
                    if h.ok:
                        passed += 1
                        print(f"  BESTANDEN ({time.time() - t0:.0f} s)")
                    else:
                        failed += 1
                        print("  FEHLGESCHLAGEN")
                except common.SkipTest as e:
                    skipped += 1
                    print(f"  ÜBERSPRUNGEN: {e}")
                except Exception as e:
                    failed += 1
                    print("  FEHLER:", type(e).__name__, str(e)[:300])
                    traceback.print_exc(limit=3)
                finally:
                    if h:
                        h.quit()
    print(f"\nFirefox-Tests: {passed} bestanden, {failed} fehlgeschlagen, {skipped} übersprungen")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
